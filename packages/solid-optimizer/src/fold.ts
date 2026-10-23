/**
 * The fold pass: constant folding, dead-code elimination, and static
 * resolution of Solid's control-flow components.
 *
 * It runs on JSX before it is lowered, so whatever it resolves never reaches
 * the JSX transform. A `<Show>` whose condition is a constant becomes its
 * branch, and the branch joins the surrounding template instead of paying for
 * a component call, a memo, and an insert.
 *
 * This is a port of the `optimize` option of `@solidjs/compiler`
 * (https://github.com/solidjs/solid/pull/3231).
 *
 * # What folds
 *
 * - Constant expressions: literals, template literals, and the unary, binary,
 *   logical, and conditional operators over them.
 * - `const` bindings, and `let` bindings nothing writes to, at any scope.
 * - Statements a constant condition makes unreachable: `if`/`else` branches,
 *   `while (false)` loops, and anything after a `return`, `throw`, `break`,
 *   or `continue`.
 * - A call of an arrow function whose body is JSX, with constant arguments,
 *   as an element's child. The call becomes the JSX with the arguments in
 *   place of the parameters, so it joins the template around it.
 * - `<For>` over a constant list, which becomes one copy of its row per
 *   item when the copies are no larger than the loop.
 * - `<Show when>`, `<For each>`, `<Repeat count>`, `<Switch>`/`<Match when>`,
 *   and `<Dynamic component>` with a static intrinsic tag name or a
 *   component declared at the top level that nothing reassigns.
 *
 * # What does not fold
 *
 * `<Portal>`, `<Loading>`, `<Errored>`, and `<Reveal>` exist for a runtime
 * condition no static analysis can decide. A control-flow component with a
 * spread attribute is left alone, since the spread can supply or override the
 * prop the fold reads. Function children also stop a fold, since the runtime
 * decides from their arity whether to call them.
 */
import type {
  CallExpression,
  ConditionalExpression,
  Directive,
  Expression,
  IdentifierReference,
  IfStatement,
  JSXChild,
  JSXElement,
  JSXEmptyExpression,
  JSXFragment,
  LogicalExpression,
  Node,
  Statement,
  WhileStatement,
} from 'oxc-parser';
import MagicString from 'magic-string';
import type { Parents } from './ast';
import {
  forEachChild,
  isInsignificant,
  isIntrinsicTag,
  isJSXChild,
  isPrimary,
  needsParensAt,
  parse,
  startsLikeStatement,
} from './ast';
import type { PassContext } from './context';
import { ConstantTable } from './constants';
import { isConstantDeclaration, solidExport, textOf } from './context';
import type { Piece } from './jsx';
import {
  findAttribute,
  hasCallbackChild,
  hasSpreadAttribute,
  innerText,
  keptPiece,
  replacedPiece,
  splicePiece,
  writePieces,
} from './jsx';
import type { Binding } from './scope';
import { lookup, scopeAt } from './scope';
import { SizeEstimator, compactLength } from './size';
import type { ConstantLookup } from './value';
import {
  arrayLiteralLength,
  effectfulParts,
  evaluate,
  isLiteralForm,
  isSideEffectFree,
  literalText,
  truthiness,
} from './value';

/**
 * The control-flow components this pass resolves.
 * `Match` is absent: it only has meaning inside a `<Switch>`, which folds it.
 */
const FOLDABLE_FLOW = new Set(['Show', 'For', 'Repeat', 'Switch', 'Dynamic']);

/**
 * What a resolved control-flow element renders in its place.
 */
type Fold =
  /** JSX children, spliced in. */
  | { readonly kind: 'children'; readonly children: readonly JSXChild[] }
  /** An element or fragment, as source text. */
  | { readonly kind: 'jsx'; readonly text: string }
  /** An expression, such as a `fallback` prop's value. */
  | {
      readonly kind: 'expression';
      readonly text: string;
      readonly primary: boolean;
    }
  | { readonly kind: 'empty' };

const EMPTY: Fold = { kind: 'empty' };

/** Solid's calls that only create a value, so the bundler can drop an unused one. */
const PURE_CALLS = new Set(['lazy', 'createContext']);

/**
 * The globals worth folding. They only apply to a reference that binds to
 * nothing, which is when the global is what runs.
 */
/**
 * Whether `node` is written to: assigned, updated, deleted, or destructured into.
 */
function isWriteTarget(node: Node, parents: Parents): boolean {
  let current = node;
  let parent = parents.get(current);
  // A destructuring pattern writes to every target inside it.
  while (
    parent &&
    (parent.type === 'ArrayPattern' ||
      parent.type === 'ObjectPattern' ||
      parent.type === 'RestElement' ||
      parent.type === 'AssignmentPattern' ||
      (parent.type === 'Property' && parents.get(parent)?.type === 'ObjectPattern'))
  ) {
    if (parent.type === 'AssignmentPattern' && parent.left !== current) {
      return false;
    }
    current = parent;
    parent = parents.get(current);
  }
  if (!parent) {
    return false;
  }
  switch (parent.type) {
    case 'AssignmentExpression':
      return parent.left === current;
    case 'UpdateExpression':
      return true;
    case 'UnaryExpression':
      return parent.operator === 'delete';
    case 'ForInStatement':
    case 'ForOfStatement':
      return parent.left === current;
    default:
      return current !== node;
  }
}

function isTerminator(statement: Node): boolean {
  return (
    statement.type === 'ReturnStatement' ||
    statement.type === 'ThrowStatement' ||
    statement.type === 'BreakStatement' ||
    statement.type === 'ContinueStatement'
  );
}

/**
 * Whether removing `statement` would remove a `var` or function declaration
 * that is hoisted out of it. Nested functions are their own scope.
 */
function containsHoistedDeclaration(statement: Node): boolean {
  let found = false;
  const visit = (node: Node): void => {
    if (found) {
      return;
    }
    if (node.type === 'VariableDeclaration' && node.kind === 'var') {
      found = true;
      return;
    }
    if (node.type === 'FunctionDeclaration') {
      found = true;
      return;
    }
    if (
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'ClassDeclaration' ||
      node.type === 'ClassExpression'
    ) {
      return;
    }
    forEachChild(node, visit);
  };
  visit(statement);
  return found;
}

/**
 * Whether a statement starting with `text` could join the statement before
 * it when that one has no semicolon.
 */
function continuesPreviousStatement(text: string): boolean {
  return /^[([`+\-/]/.test(text);
}

/** The name a property key or a computed member's string literal gives. */
function keyName(node: Node): string | undefined {
  if (node.type === 'Identifier') {
    return node.name;
  }
  return node.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined;
}

type ConstantItem =
  | { readonly kind: 'primitive'; readonly text: string }
  | { readonly kind: 'object'; readonly keys: ReadonlyMap<string, string> };

/**
 * The text of an expression that always gives the same primitive: a literal
 * other than a regular expression, a template literal without expressions,
 * or a negated number.
 */
function primitiveText(context: PassContext, node: Expression): string | undefined {
  let expression: Expression = node;
  while (expression.type === 'ParenthesizedExpression') {
    expression = expression.expression;
  }
  switch (expression.type) {
    case 'Literal':
      return 'regex' in expression ? undefined : textOf(context, expression);
    case 'TemplateLiteral':
      return expression.expressions.length === 0 ? textOf(context, expression) : undefined;
    case 'UnaryExpression':
      return expression.operator === '-' &&
        expression.argument.type === 'Literal' &&
        typeof expression.argument.value === 'number'
        ? textOf(context, expression)
        : undefined;
    default:
      return undefined;
  }
}

/** Whether a child of `parent` is inserted into its template, not passed as a prop. */
function joinsTemplate(parent: JSXElement | JSXFragment): boolean {
  if (parent.type === 'JSXFragment') {
    return true;
  }
  const { name } = parent.openingElement;
  return name.type === 'JSXIdentifier' && isIntrinsicTag(name.name);
}

/**
 * Whether JSX holds a `ref` or a spread, which run while the JSX is made.
 */
function hasRefOrSpread(root: Node): boolean {
  let found = false;
  const visit = (node: Node): void => {
    if (found) {
      return;
    }
    if (
      node.type === 'JSXSpreadAttribute' ||
      node.type === 'JSXSpreadChild' ||
      (node.type === 'JSXAttribute' &&
        node.name.type === 'JSXIdentifier' &&
        node.name.name === 'ref')
    ) {
      found = true;
      return;
    }
    forEachChild(node, visit);
  };
  visit(root);
  return found;
}

class Folder {
  changed = false;

  private readonly lookup: ConstantLookup;

  constructor(private readonly context: PassContext) {
    this.lookup = new ConstantTable(context.scopes, context.options).lookup;
  }

  // ---------------------------------------------------------------------------
  // Traversal
  // ---------------------------------------------------------------------------

  walk(node: Node): void {
    forEachChild(node, (child) => {
      this.walk(child);
    });
    this.exit(node);
  }

  private exit(node: Node): void {
    switch (node.type) {
      case 'Program':
      case 'BlockStatement':
      case 'StaticBlock':
        this.eliminateDeadStatements(node.body);
        break;
      case 'SwitchCase':
        this.eliminateDeadStatements(node.consequent);
        break;
      case 'JSXElement':
        this.foldChildren(node);
        if (!this.isJSXChildOrAttribute(node)) {
          this.foldFlowExpression(node);
        }
        break;
      case 'JSXFragment':
        this.foldChildren(node);
        break;
      case 'LogicalExpression':
        this.foldLogical(node);
        break;
      case 'ConditionalExpression':
        this.foldConditional(node);
        break;
      case 'Identifier':
        if (this.context.scopes.references.has(node)) {
          this.foldConstant(node);
        }
        break;
      case 'TemplateLiteral':
        // A tagged template passes its strings to the tag, so they are not constants.
        if (this.context.parents.get(node)?.type !== 'TaggedTemplateExpression') {
          this.foldConstant(node);
        }
        break;
      case 'UnaryExpression':
      case 'BinaryExpression':
      case 'ParenthesizedExpression':
        this.foldConstant(node);
        break;
      case 'MemberExpression':
        // Only a read folds. Writing to a namespace member throws, so it stays.
        if (!isWriteTarget(node, this.context.parents)) {
          this.foldConstant(node);
        }
        break;
      case 'CallExpression':
        this.annotatePure(node);
        break;
      default:
        break;
    }
  }

  private isJSXChildOrAttribute(node: Node): boolean {
    return (
      isJSXChild(node, this.context.parents) ||
      this.context.parents.get(node)?.type === 'JSXAttribute'
    );
  }

  private replace(node: Node, text: string): void {
    if (textOf(this.context, node) === text) {
      return;
    }
    this.context.s.overwrite(node.start, node.end, text);
    this.changed = true;
  }

  // ---------------------------------------------------------------------------
  // Expressions
  // ---------------------------------------------------------------------------

  /**
   * Marks a call to Solid's `lazy` or `createContext` as pure. `lazy` only
   * creates the component, and loads nothing until it renders. A folded
   * branch can leave it unused, and the annotation lets the bundler drop it
   * along with its dynamic import. `createContext` only creates the context,
   * which inlining can leave unused.
   */
  private annotatePure(call: CallExpression): void {
    if (call.callee.type !== 'Identifier') {
      return;
    }
    const binding = this.context.scopes.references.get(call.callee);
    const identity = binding ? solidExport(binding, this.context.options) : undefined;
    if (identity === undefined || !PURE_CALLS.has(identity)) {
      return;
    }
    const before = this.context.code.slice(0, call.start).trimEnd();
    if (/(#|@)__PURE__\s*\*\/$/.test(before)) {
      return;
    }
    this.context.s.prependLeft(call.start, '/* @__PURE__ */ ');
    this.changed = true;
  }

  private foldConstant(node: Node): void {
    if (isLiteralForm(node)) {
      return;
    }
    const value = evaluate(node, this.lookup);
    if (!value) {
      return;
    }
    let text = literalText(value.value);
    if (text === undefined) {
      return;
    }
    const parent = this.context.parents.get(node);
    if (node.type === 'Identifier') {
      // `export { A }` names the binding, not its value.
      if (parent?.type === 'ExportSpecifier') {
        return;
      }
      // `{ enabled }` cannot stay shorthand once its value is a literal.
      if (parent?.type === 'Property' && parent.shorthand) {
        this.replace(node, `${node.name}: ${text}`);
        return;
      }
    }
    if (
      parent?.type === 'MemberExpression' &&
      parent.object === node &&
      typeof value.value === 'number' &&
      !text.startsWith('(')
    ) {
      // `1.toFixed()` does not parse.
      text = `(${text})`;
    }
    if (parent?.type === 'ExpressionStatement' && typeof value.value === 'string') {
      // A string at the start of a statement can turn into a directive.
      text = `(${text})`;
    }
    this.replace(node, text);
  }

  /**
   * Keeps `value`, evaluating `discarded` first when it has side effects.
   * `(discarded, value)` runs it in the same order and yields the same result.
   */
  private keepAfter(target: Node, discarded: Expression | undefined, value: Expression): string {
    const parts = discarded ? effectfulParts(discarded) : [];
    if (parts.length === 0) {
      const text = textOf(this.context, value);
      return needsParensAt(target, value, this.context.parents) ? `(${text})` : text;
    }
    const texts = parts.map((part) => textOf(this.context, part));
    texts.push(textOf(this.context, value));
    return `(${texts.join(', ')})`;
  }

  private foldLogical(node: LogicalExpression): void {
    const left = truthiness(node.left, this.lookup);
    if (left === undefined) {
      return;
    }
    let takesLeft: boolean;
    if (node.operator === '&&') {
      takesLeft = !left;
    } else if (node.operator === '||') {
      takesLeft = left;
    } else {
      // `??` depends on nullishness, not truthiness, so it only folds against a constant.
      const value = evaluate(node.left, this.lookup);
      if (!value) {
        return;
      }
      takesLeft = value.value != null;
    }
    // The side a short-circuit never reaches never runs, so dropping it is free.
    // The side that does run has to be skippable before the other replaces it.
    if (takesLeft) {
      this.replace(node, this.keepAfter(node, undefined, node.left));
    } else {
      const discarded = this.isSkippable(node.left) ? undefined : node.left;
      this.replace(node, this.keepAfter(node, discarded, node.right));
    }
  }

  /**
   * Whether dropping `node` changes nothing. An expression that evaluates to
   * a constant only reads bindings and runs operators on primitives.
   */
  private isSkippable(node: Expression): boolean {
    return isSideEffectFree(node) || evaluate(node, this.lookup) !== undefined;
  }

  private foldConditional(node: ConditionalExpression): void {
    const test = truthiness(node.test, this.lookup);
    if (test === undefined) {
      return;
    }
    const discarded = this.isSkippable(node.test) ? undefined : node.test;
    this.replace(node, this.keepAfter(node, discarded, test ? node.consequent : node.alternate));
  }

  // ---------------------------------------------------------------------------
  // Control-flow components
  // ---------------------------------------------------------------------------

  /**
   * The Solid built-in a tag refers to.
   *
   * Being in `builtIns` only makes a name a candidate. The tag has to resolve
   * to Solid's own component: a tag that binds to nothing is the built-in the
   * JSX transform imports, and an import from a Solid module is decided by
   * the name the module exports, so `<Cond>` from `import { Show as Cond }` is
   * `Show`. A local `Show` or one from another module is a different component.
   */
  private builtInTag(element: JSXElement): string | undefined {
    const { name } = element.openingElement;
    if (name.type !== 'JSXIdentifier') {
      return undefined;
    }
    const { references } = this.context.scopes;
    if (!references.has(name)) {
      return undefined;
    }
    const binding = references.get(name);
    const identity = binding ? solidExport(binding, this.context.options) : name.name;
    if (identity === undefined || !this.context.options.builtIns.has(identity)) {
      return undefined;
    }
    return identity;
  }

  /**
   * The name of the component an identifier refers to, when it is a
   * capitalized top-level binding nothing reassigns, holding a function or a
   * `lazy` component. A JSX tag with that name calls the same component. An
   * import could hold anything, such as a tag name string, so it is left out.
   */
  private componentName(identifier: IdentifierReference): string | undefined {
    const binding = this.context.scopes.references.get(identifier);
    if (
      !binding ||
      binding.mutated ||
      binding.scope.parent !== undefined ||
      !/^[A-Z]/.test(binding.name)
    ) {
      return undefined;
    }
    const { declaration } = binding;
    if (declaration.type === 'FunctionDeclaration') {
      return declaration.async || declaration.generator ? undefined : binding.name;
    }
    if (
      declaration.type !== 'VariableDeclarator' ||
      declaration.id !== binding.identifier ||
      !declaration.init ||
      !isConstantDeclaration(binding, this.context.options)
    ) {
      return undefined;
    }
    let init: Expression = declaration.init;
    while (init.type === 'ParenthesizedExpression') {
      init = init.expression;
    }
    if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
      return init.async || init.generator ? undefined : binding.name;
    }
    if (init.type === 'CallExpression' && init.callee.type === 'Identifier') {
      const callee = this.context.scopes.references.get(init.callee);
      return callee && solidExport(callee, this.context.options) === 'lazy'
        ? binding.name
        : undefined;
    }
    return undefined;
  }

  private flowTag(element: JSXElement): string | undefined {
    const tag = this.builtInTag(element);
    return tag !== undefined && FOLDABLE_FLOW.has(tag) ? tag : undefined;
  }

  private foldFlow(element: JSXElement): Fold | undefined {
    const tag = this.flowTag(element);
    if (tag === undefined || hasSpreadAttribute(element)) {
      return undefined;
    }
    switch (tag) {
      case 'Show':
        return this.foldShow(element);
      case 'For':
        return this.foldFor(element);
      case 'Repeat':
        return this.foldRepeat(element);
      case 'Switch':
        return this.foldSwitch(element);
      case 'Dynamic':
        return this.foldDynamic(element);
      default:
        return undefined;
    }
  }

  /**
   * Whether a prop is statically truthy or falsy. A bare attribute is `true`.
   * The prop is discarded by the fold, so it also has to be skippable.
   */
  private attributeTruthiness(element: JSXElement, name: string): boolean | undefined {
    const attribute = findAttribute(element, name);
    if (!attribute) {
      return undefined;
    }
    const { value } = attribute;
    if (value === null) {
      return true;
    }
    switch (value.type) {
      case 'Literal':
        return value.value !== '';
      case 'JSXElement':
      case 'JSXFragment':
        return true;
      default:
        if (value.expression.type === 'JSXEmptyExpression' || !isSideEffectFree(value.expression)) {
          return undefined;
        }
        return truthiness(value.expression, this.lookup);
    }
  }

  /**
   * What the element renders when its condition fails: its `fallback` prop, or nothing.
   */
  private fallback(element: JSXElement): Fold | undefined {
    const attribute = findAttribute(element, 'fallback');
    if (!attribute?.value) {
      // A bare `fallback` is `fallback={true}`, which renders nothing.
      return EMPTY;
    }
    const { value } = attribute;
    switch (value.type) {
      case 'Literal':
        // An attribute string can hold HTML entities, which are not decoded here.
        if (value.value.includes('&')) {
          return undefined;
        }
        return {
          kind: 'expression',
          text: JSON.stringify(value.value),
          primary: true,
        };
      case 'JSXElement':
      case 'JSXFragment':
        return { kind: 'jsx', text: textOf(this.context, value) };
      default:
        if (value.expression.type === 'JSXEmptyExpression') {
          return EMPTY;
        }
        // JSX in a container splices like JSX, so it can join the surrounding template.
        if (value.expression.type === 'JSXElement' || value.expression.type === 'JSXFragment') {
          return { kind: 'jsx', text: textOf(this.context, value.expression) };
        }
        return {
          kind: 'expression',
          text: textOf(this.context, value.expression),
          primary: isPrimary(value.expression),
        };
    }
  }

  private foldShow(element: JSXElement): Fold | undefined {
    const when = this.attributeTruthiness(element, 'when');
    if (when === undefined) {
      return undefined;
    }
    if (!when) {
      return this.fallback(element);
    }
    if (hasCallbackChild(element.children)) {
      return undefined;
    }
    return { kind: 'children', children: element.children };
  }

  private foldFor(element: JSXElement): Fold | undefined {
    const each = findAttribute(element, 'each');
    if (
      each?.value?.type !== 'JSXExpressionContainer' ||
      each.value.expression.type === 'JSXEmptyExpression'
    ) {
      return undefined;
    }
    const { expression } = each.value;
    // `each={[]}` renders the fallback, and so does a statically falsy `each`,
    // which `mapArray` treats as an empty list. Either way the expression is
    // dropped, so it has to be skippable.
    const empty =
      arrayLiteralLength(expression) === 0 || truthiness(expression, this.lookup) === false;
    if (!empty) {
      return this.unrollFor(element, expression);
    }
    if (!isSideEffectFree(expression)) {
      return undefined;
    }
    return this.fallback(element);
  }

  /**
   * Unrolls `<For>` over a constant list into one copy of its row per item.
   *
   * The list is an array literal, or a binding of one that only `<For>`
   * reads, so nothing can change it. Each item is a primitive literal, or an
   * object literal of them. The row is an arrow function whose body is JSX,
   * and reads the item as `item.key`, or as itself when it is a primitive.
   * Each row ran once, untracked, under its own owner. A copy is made with
   * the JSX around it instead, which runs untracked too, and the JSX
   * transform gives every dynamic part its own effect. A `ref` or a spread
   * would run while the copy is made, so either one keeps the loop.
   */
  private unrollFor(element: JSXElement, expression: Expression): Fold | undefined {
    if (
      element.openingElement.attributes.some(
        (attribute) =>
          attribute.type === 'JSXAttribute' &&
          attribute.name.type === 'JSXIdentifier' &&
          attribute.name.name === 'keyed' &&
          !(
            attribute.value?.type === 'JSXExpressionContainer' &&
            attribute.value.expression.type === 'Literal' &&
            attribute.value.expression.value === false
          ),
      )
    ) {
      return undefined;
    }
    const byIndex = findAttribute(element, 'keyed') !== undefined;
    const list = this.constantList(expression);
    if (!list) {
      return undefined;
    }
    const significant = element.children.filter((child) => !isInsignificant(child));
    const only = significant.at(0);
    if (significant.length !== 1 || only?.type !== 'JSXExpressionContainer') {
      return undefined;
    }
    let row: Node = only.expression;
    while (row.type === 'ParenthesizedExpression') {
      row = row.expression;
    }
    if (
      row.type !== 'ArrowFunctionExpression' ||
      row.async ||
      !row.expression ||
      row.params.length > 2
    ) {
      return undefined;
    }
    let body: Node = row.body;
    while (body.type === 'ParenthesizedExpression') {
      body = body.expression;
    }
    if ((body.type !== 'JSXElement' && body.type !== 'JSXFragment') || hasRefOrSpread(body)) {
      return undefined;
    }
    // A fold inside the row in this pass would be lost, so it waits for the next pass.
    if (
      this.context.s.slice(body.start, body.end) !== this.context.code.slice(body.start, body.end)
    ) {
      return undefined;
    }
    const scope = this.context.scopes.scopes.get(row);
    if (!scope) {
      return undefined;
    }
    const params: Binding[] = [];
    for (const param of row.params) {
      const binding = param.type === 'Identifier' ? scope.bindings.get(param.name) : undefined;
      if (!binding || binding.mutated) {
        return undefined;
      }
      params.push(binding);
    }
    const itemParam = params.at(0);
    const indexParam = params.at(1);
    const rows: string[] = [];
    for (const [index, item] of list.items.entries()) {
      const copy = new MagicString(this.context.code);
      // With `keyed={false}` the item is an accessor and the index a number, and the other way around otherwise.
      if (
        (itemParam && !this.substituteItem(copy, itemParam, item, byIndex)) ||
        (indexParam && !this.substituteIndex(copy, indexParam, index, !byIndex))
      ) {
        return undefined;
      }
      rows.push(copy.slice(body.start, body.end));
    }
    const text = `<>${rows.join('')}</>`;
    if (!this.unrollingPays(element, text, list.declaration)) {
      return undefined;
    }
    return { kind: 'jsx', text };
  }

  /**
   * The items of a constant list, and the declaration that goes once no
   * `<For>` reads it.
   */
  private constantList(
    expression: Expression,
  ): { items: ConstantItem[]; declaration: Node | undefined } | undefined {
    let node: Expression = expression;
    while (node.type === 'ParenthesizedExpression') {
      node = node.expression;
    }
    let declaration: Node | undefined;
    if (node.type === 'Identifier') {
      const binding = this.context.scopes.references.get(node);
      if (
        binding?.declaration.type !== 'VariableDeclarator' ||
        binding.declaration.id !== binding.identifier ||
        !binding.declaration.init ||
        !isConstantDeclaration(binding, this.context.options)
      ) {
        return undefined;
      }
      // Any other use could change the list, and an export can be changed by another module.
      const statement = this.context.parents.get(binding.declaration);
      const owner = statement ? this.context.parents.get(statement) : undefined;
      if (
        owner?.type === 'ExportNamedDeclaration' ||
        !binding.references.every((reference) => this.isForEach(reference))
      ) {
        return undefined;
      }
      node = binding.declaration.init;
      while (node.type === 'ParenthesizedExpression') {
        node = node.expression;
      }
      declaration =
        binding.references.length === 1 &&
        statement?.type === 'VariableDeclaration' &&
        statement.declarations.length === 1
          ? statement
          : undefined;
    }
    if (node.type !== 'ArrayExpression') {
      return undefined;
    }
    const items: ConstantItem[] = [];
    for (const element of node.elements) {
      const item =
        element && element.type !== 'SpreadElement' ? this.constantItem(element) : undefined;
      if (!item) {
        return undefined;
      }
      items.push(item);
    }
    return { items, declaration };
  }

  /** Whether a reference is the whole `each` of a Solid `<For>`. */
  private isForEach(reference: Node): boolean {
    const container = this.context.parents.get(reference);
    const attribute = container ? this.context.parents.get(container) : undefined;
    const opening = attribute ? this.context.parents.get(attribute) : undefined;
    const element = opening ? this.context.parents.get(opening) : undefined;
    return (
      container?.type === 'JSXExpressionContainer' &&
      attribute?.type === 'JSXAttribute' &&
      attribute.name.type === 'JSXIdentifier' &&
      attribute.name.name === 'each' &&
      element?.type === 'JSXElement' &&
      this.builtInTag(element) === 'For'
    );
  }

  /** A list item whose value is known: a primitive literal, or an object literal of them. */
  private constantItem(node: Expression): ConstantItem | undefined {
    const primitive = primitiveText(this.context, node);
    if (primitive !== undefined) {
      return { kind: 'primitive', text: primitive };
    }
    if (node.type !== 'ObjectExpression') {
      return undefined;
    }
    const keys = new Map<string, string>();
    for (const property of node.properties) {
      if (
        property.type !== 'Property' ||
        property.kind !== 'init' ||
        property.method ||
        property.computed
      ) {
        return undefined;
      }
      const key = keyName(property.key);
      const value = primitiveText(this.context, property.value);
      if (key === undefined || value === undefined || key === '__proto__') {
        return undefined;
      }
      keys.set(key, value);
    }
    return { kind: 'object', keys };
  }

  /**
   * Writes an item's value over each read of the row's item parameter.
   * `false` when a read is not one the value can take the place of.
   */
  private substituteItem(
    copy: MagicString,
    param: Binding,
    item: ConstantItem,
    accessor: boolean,
  ): boolean {
    for (const reference of param.references) {
      let read: Node = reference;
      if (accessor) {
        const call = this.context.parents.get(reference);
        if (
          call?.type !== 'CallExpression' ||
          call.callee !== reference ||
          call.arguments.length > 0
        ) {
          return false;
        }
        read = call;
      }
      if (item.kind === 'primitive') {
        copy.overwrite(read.start, read.end, this.valueAt(read, item.text));
        continue;
      }
      const member = this.context.parents.get(read);
      if (
        member?.type !== 'MemberExpression' ||
        member.object !== read ||
        isWriteTarget(member, this.context.parents)
      ) {
        return false;
      }
      // `item[name]` reads a variable key, so only a string literal counts when computed.
      let key: string | undefined;
      if (!member.computed) {
        key = member.property.type === 'Identifier' ? member.property.name : undefined;
      } else if (member.property.type === 'Literal') {
        key = keyName(member.property);
      }
      // A call would run with the item as `this`, and a missing key could be on the prototype.
      const parent = this.context.parents.get(member);
      if (
        key === undefined ||
        (parent?.type === 'CallExpression' && parent.callee === member) ||
        !item.keys.has(key)
      ) {
        return false;
      }
      copy.overwrite(
        member.start,
        member.end,
        this.valueAt(member, item.keys.get(key) ?? 'void 0'),
      );
    }
    return true;
  }

  /** A value's text in place of `node`, with parentheses unless it fills a JSX container. */
  private valueAt(node: Node, text: string): string {
    return this.context.parents.get(node)?.type === 'JSXExpressionContainer' ? text : `(${text})`;
  }

  /** Writes an item's index over each read of the row's index parameter. */
  private substituteIndex(
    copy: MagicString,
    param: Binding,
    index: number,
    accessor: boolean,
  ): boolean {
    for (const reference of param.references) {
      let read: Node = reference;
      if (accessor) {
        const call = this.context.parents.get(reference);
        if (
          call?.type !== 'CallExpression' ||
          call.callee !== reference ||
          call.arguments.length > 0
        ) {
          return false;
        }
        read = call;
      }
      copy.overwrite(read.start, read.end, String(index));
    }
    return true;
  }

  /**
   * Whether the copies are estimated to be no larger, once lowered, than
   * the loop and the list it no longer needs.
   */
  private unrollingPays(element: JSXElement, text: string, declaration: Node | undefined): boolean {
    const inTemplate = this.joinsParentTemplate(element);
    const loop =
      new SizeEstimator(this.context.code).jsx(element, inTemplate) +
      (declaration
        ? compactLength(this.context.code.slice(declaration.start, declaration.end))
        : 0);
    const code = `const __so_rows__ = ${text};`;
    const program = parse(this.context.filename, code);
    const statement = program.body.at(0);
    const init =
      statement?.type === 'VariableDeclaration' ? statement.declarations.at(0)?.init : undefined;
    if (init?.type !== 'JSXFragment') {
      return false;
    }
    // In an element, the rows splice into its template. Elsewhere they are a fragment of templates.
    const estimator = new SizeEstimator(code);
    const unrolled = inTemplate
      ? init.children.reduce(
          (size, child) =>
            size +
            (child.type === 'JSXElement' ? estimator.jsx(child, true) : estimator.node(child)),
          0,
        )
      : estimator.jsx(init, false);
    return unrolled <= loop;
  }

  /** Whether an element sits directly in an element or fragment whose template it joins. */
  private joinsParentTemplate(element: JSXElement): boolean {
    const parent = this.context.parents.get(element);
    return (
      (parent?.type === 'JSXElement' && joinsTemplate(parent)) || parent?.type === 'JSXFragment'
    );
  }

  private foldRepeat(element: JSXElement): Fold | undefined {
    const count = findAttribute(element, 'count');
    if (
      count?.value?.type !== 'JSXExpressionContainer' ||
      count.value.expression.type === 'JSXEmptyExpression'
    ) {
      return undefined;
    }
    const value = evaluate(count.value.expression, this.lookup);
    if (typeof value?.value !== 'number') {
      return undefined;
    }
    // Written this way so `NaN` counts as empty, like `repeat` does.
    if (value.value >= 1) {
      return undefined;
    }
    return this.fallback(element);
  }

  /**
   * Resolves a `<Switch>` as far as its `<Match when>` conditions allow.
   * Statically false matches are dropped, a statically true match with no
   * undecided match before it wins, and a switch whose every match is false
   * renders its fallback.
   */
  private foldSwitch(element: JSXElement): Fold | undefined {
    const matches: { element: JSXElement; when: boolean | undefined }[] = [];
    for (const child of element.children) {
      if (isInsignificant(child)) {
        continue;
      }
      // Anything else in a `<Switch>` is outside what this pass models.
      if (
        child.type !== 'JSXElement' ||
        this.builtInTag(child) !== 'Match' ||
        hasSpreadAttribute(child) ||
        !findAttribute(child, 'when')
      ) {
        return undefined;
      }
      matches.push({ element: child, when: this.attributeTruthiness(child, 'when') });
    }
    if (matches.length === 0) {
      return undefined;
    }

    const winner = matches.findIndex((item) => item.when === true);
    if (winner !== -1 && matches.slice(0, winner).every((item) => item.when === false)) {
      const match = matches.at(winner);
      if (!match || hasCallbackChild(match.element.children)) {
        return undefined;
      }
      return { kind: 'children', children: match.element.children };
    }

    if (matches.every((item) => item.when === false)) {
      return this.fallback(element);
    }

    // No outcome yet. A statically false match never renders, but the runtime
    // would still evaluate it each time the switch updates, so it is removed.
    for (const item of matches) {
      if (item.when === false) {
        this.context.s.remove(item.element.start, item.element.end);
        this.changed = true;
      }
    }
    return undefined;
  }

  /**
   * `<Dynamic component="div">` is just `<div>`, which the JSX transform can
   * put in a template instead of creating the element at runtime.
   */
  /**
   * `<Dynamic component="div">` becomes `<div>`. `<Dynamic component={Card}>`
   * becomes `<Card>` when `Card` is a component declared at the top level
   * that nothing reassigns. `<Dynamic>` then only renders `Card` with the
   * other props, through a memo that never changes.
   */
  private foldDynamic(element: JSXElement): Fold | undefined {
    const component = findAttribute(element, 'component');
    if (!component?.value) {
      return undefined;
    }
    let tag: string | undefined;
    const { value } = component;
    if (value.type === 'Literal') {
      tag = isIntrinsicTag(value.value) ? value.value : undefined;
    } else if (
      value.type === 'JSXExpressionContainer' &&
      value.expression.type !== 'JSXEmptyExpression'
    ) {
      const expression =
        value.expression.type === 'ParenthesizedExpression'
          ? value.expression.expression
          : value.expression;
      if (expression.type === 'Identifier') {
        tag = this.componentName(expression);
      }
      if (tag === undefined) {
        const result = evaluate(value.expression, this.lookup);
        if (typeof result?.value === 'string' && isIntrinsicTag(result.value)) {
          tag = result.value;
        }
      }
    }
    if (tag === undefined) {
      return undefined;
    }
    const attributes = element.openingElement.attributes
      .filter((attribute) => attribute !== component)
      .map((attribute) => textOf(this.context, attribute));
    const opening = [tag, ...attributes].join(' ');
    const text = element.closingElement
      ? `<${opening}>${innerText(this.context.s, element)}</${tag}>`
      : `<${opening} />`;
    return { kind: 'jsx', text };
  }

  /**
   * Replaces a control-flow element that is not a JSX child.
   */
  private foldFlowExpression(element: JSXElement): void {
    const resolved = this.foldFlow(element);
    if (!resolved) {
      return;
    }
    this.replace(element, this.expressionText(resolved));
  }

  private expressionText(resolved: Fold): string {
    switch (resolved.kind) {
      case 'empty':
        return 'null';
      case 'jsx':
        return resolved.text;
      case 'expression':
        return resolved.primary ? resolved.text : `(${resolved.text})`;
      default: {
        const significant = resolved.children.filter((child) => !isInsignificant(child));
        const only = significant.at(0);
        if (only === undefined) {
          return 'null';
        }
        if (
          significant.length === 1 &&
          (only.type === 'JSXElement' || only.type === 'JSXFragment')
        ) {
          return textOf(this.context, only);
        }
        const first = resolved.children.at(0);
        const last = resolved.children.at(-1);
        if (!first || !last) {
          return 'null';
        }
        return `<>${this.context.s.slice(first.start, last.end)}</>`;
      }
    }
  }

  /**
   * Replaces every resolvable control-flow child with what it renders.
   */
  private foldChildren(parent: JSXElement | JSXFragment): void {
    const pieces: Piece[] = [];
    let folded = false;
    for (const child of parent.children) {
      // A fragment among JSX children is the same as its children, and Solid's
      // JSX transform only compiles the spliced form.
      if (child.type === 'JSXFragment') {
        folded = true;
        pieces.push(splicePiece(this.context.s, child, child.children));
        continue;
      }
      const reduced =
        child.type === 'JSXExpressionContainer' && joinsTemplate(parent)
          ? this.reducedCall(child.expression)
          : undefined;
      if (reduced !== undefined) {
        folded = true;
        pieces.push(replacedPiece(child, reduced));
        continue;
      }
      const resolved = child.type === 'JSXElement' ? this.foldFlow(child) : undefined;
      if (!resolved) {
        pieces.push(keptPiece(child));
        continue;
      }
      folded = true;
      switch (resolved.kind) {
        case 'children':
          pieces.push(splicePiece(this.context.s, child, resolved.children));
          break;
        case 'jsx':
          pieces.push(replacedPiece(child, resolved.text));
          break;
        case 'expression':
          pieces.push(replacedPiece(child, `{${resolved.text}}`));
          break;
        default:
          pieces.push(replacedPiece(child, ''));
          break;
      }
    }
    if (folded && writePieces(this.context.s, pieces)) {
      this.changed = true;
    }
  }

  /**
   * The JSX a call like `((n) => <li>{n}</li>)(1)` makes, with each
   * argument in place of its parameter, or `undefined` when that could
   * behave differently.
   *
   * The child is inserted by an effect that makes the JSX. The JSX
   * transform wraps every dynamic part of JSX in an effect of its own, so
   * making it reads nothing the outer effect tracks, and the outer effect
   * runs once. A `ref` runs while the JSX is made, and a spread reads its
   * object there, so either one keeps the call. Each argument has to be a
   * constant or a binding nothing reassigns, so reading it again where the
   * parameter was gives the same value.
   */
  private reducedCall(expression: Expression | JSXEmptyExpression): string | undefined {
    if (expression.type !== 'CallExpression' || expression.optional) {
      return undefined;
    }
    let callee: Expression = expression.callee;
    while (callee.type === 'ParenthesizedExpression') {
      callee = callee.expression;
    }
    if (callee.type !== 'ArrowFunctionExpression' || callee.async || !callee.expression) {
      return undefined;
    }
    let body: Node = callee.body;
    while (body.type === 'ParenthesizedExpression') {
      body = body.expression;
    }
    if (body.type !== 'JSXElement' && body.type !== 'JSXFragment') {
      return undefined;
    }
    const { params } = callee;
    const args = expression.arguments;
    if (params.length !== args.length || hasRefOrSpread(body)) {
      return undefined;
    }
    // A fold inside the body in this pass would be lost, so it waits for the next pass.
    if (
      this.context.s.slice(body.start, body.end) !== this.context.code.slice(body.start, body.end)
    ) {
      return undefined;
    }
    const scope = this.context.scopes.scopes.get(callee);
    if (!scope) {
      return undefined;
    }
    const copy = new MagicString(this.context.code);
    for (const [index, param] of params.entries()) {
      const arg = args.at(index);
      if (param.type !== 'Identifier' || !arg || arg.type === 'SpreadElement') {
        return undefined;
      }
      const binding = scope.bindings.get(param.name);
      const text = this.argumentText(arg);
      if (!binding || binding.mutated || text === undefined) {
        return undefined;
      }
      for (const reference of binding.references) {
        // A binding argument has to mean the same where the parameter was read.
        if (
          arg.type === 'Identifier' &&
          lookup(scopeAt(this.context.scopes, this.context.parents, reference), arg.name) !==
            this.context.scopes.references.get(arg)
        ) {
          return undefined;
        }
        const parent = this.context.parents.get(reference);
        const shorthand =
          parent?.type === 'Property' && parent.shorthand && parent.value === reference;
        copy.overwrite(reference.start, reference.end, shorthand ? `${param.name}: ${text}` : text);
      }
    }
    return copy.slice(body.start, body.end);
  }

  /** The text of an argument that reads the same wherever it is copied. */
  private argumentText(arg: Expression): string | undefined {
    let node: Expression = arg;
    while (node.type === 'ParenthesizedExpression') {
      node = node.expression;
    }
    switch (node.type) {
      case 'Literal':
        return 'regex' in node ? undefined : textOf(this.context, node);
      case 'TemplateLiteral':
        return node.expressions.length === 0 ? textOf(this.context, node) : undefined;
      case 'UnaryExpression':
        return node.operator === '-' && node.argument.type === 'Literal'
          ? `(${textOf(this.context, node)})`
          : undefined;
      case 'Identifier': {
        const binding = this.context.scopes.references.get(node);
        return binding && !binding.mutated ? node.name : undefined;
      }
      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Dead statements
  // ---------------------------------------------------------------------------

  private eliminateDeadStatements(statements: (Statement | Directive)[]): void {
    let terminator = -1;
    for (const [index, statement] of statements.entries()) {
      let terminates = isTerminator(statement);
      if (statement.type === 'IfStatement') {
        const kept = this.resolveIf(statement);
        if (kept !== undefined) {
          terminates = kept !== null && isTerminator(kept);
        }
      } else if (statement.type === 'WhileStatement') {
        this.resolveWhile(statement);
      }
      if (terminates && terminator === -1) {
        terminator = index;
      }
    }

    // Everything after the first terminator is unreachable, but a `var` or
    // function declaration in it is still hoisted, so the list stays intact.
    if (terminator === -1) {
      return;
    }
    const unreachable = statements.slice(terminator + 1);
    const first = unreachable.at(0);
    const last = unreachable.at(-1);
    if (first && last && !unreachable.some(containsHoistedDeclaration)) {
      this.context.s.remove(first.start, last.end);
      this.changed = true;
    }
  }

  private replaceStatement(statement: Node, text: string): void {
    if (text === '') {
      this.context.s.remove(statement.start, statement.end);
      this.changed = true;
      return;
    }
    this.replace(statement, continuesPreviousStatement(text) ? `;${text}` : text);
  }

  /**
   * A statement that keeps a discarded test's side effects, or `undefined`
   * when skipping the test changes nothing.
   */
  private discardedTest(test: Expression): string | undefined {
    const parts = effectfulParts(test);
    const first = parts.at(0);
    if (first === undefined) {
      return undefined;
    }
    const text = parts.map((part) => textOf(this.context, part)).join(', ');
    return startsLikeStatement(first) ? `(${text});` : `${text};`;
  }

  /**
   * Resolves an `if` with a constant test. Returns the kept branch, `null`
   * when no branch is kept, or `undefined` when the statement stays.
   */
  private resolveIf(statement: IfStatement): Statement | null | undefined {
    const test = truthiness(statement.test, this.lookup);
    if (test === undefined) {
      return undefined;
    }
    const dropped = test ? statement.alternate : statement.consequent;
    if (dropped && containsHoistedDeclaration(dropped)) {
      return undefined;
    }
    const kept = test ? statement.consequent : statement.alternate;
    // A bare function declaration as a branch is web-compatibility semantics,
    // not something to move into the enclosing list.
    if (kept?.type === 'FunctionDeclaration') {
      return undefined;
    }
    const parts: string[] = [];
    const effect = this.discardedTest(statement.test);
    if (effect !== undefined) {
      parts.push(effect);
    }
    if (kept) {
      parts.push(textOf(this.context, kept));
    }
    this.replaceStatement(statement, parts.join(' '));
    return kept;
  }

  private resolveWhile(statement: WhileStatement): void {
    if (truthiness(statement.test, this.lookup) !== false) {
      return;
    }
    if (containsHoistedDeclaration(statement.body)) {
      return;
    }
    // A `while` with a falsy test evaluates the test once and never enters the body.
    this.replaceStatement(statement, this.discardedTest(statement.test) ?? '');
  }
}

/**
 * Runs the fold pass over a parsed program. Returns whether anything changed.
 */
export function fold(context: PassContext): boolean {
  const folder = new Folder(context);
  folder.walk(context.program);
  return folder.changed;
}
