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
 * - `<Show when>`, `<For each>`, `<Repeat count>`, `<Switch>`/`<Match when>`,
 *   and `<Dynamic component>` with a static intrinsic tag name.
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
  ConditionalExpression,
  Directive,
  Expression,
  IfStatement,
  JSXChild,
  JSXElement,
  JSXFragment,
  LogicalExpression,
  Node,
  Statement,
  WhileStatement,
} from 'oxc-parser';
import {
  forEachChild,
  isFilteredText,
  isIntrinsicTag,
  isJSXChild,
  isPrimary,
  needsParensAt,
  startsLikeStatement,
} from './ast';
import type { PassContext } from './context';
import { textOf } from './context';
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
import type { Const, ConstantLookup } from './value';
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

/**
 * The globals worth folding. They only apply to a reference that binds to
 * nothing, which is when the global is what runs.
 */
function globalValue(name: string): Const | undefined {
  switch (name) {
    case 'undefined':
      return { value: undefined };
    case 'NaN':
      return { value: Number.NaN };
    case 'Infinity':
      return { value: Number.POSITIVE_INFINITY };
    default:
      return undefined;
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

class Folder {
  changed = false;

  private readonly lookup: ConstantLookup;

  private readonly constants = new Map<Binding, Const | null>();

  private readonly evaluating = new Set<Binding>();

  constructor(private readonly context: PassContext) {
    this.lookup = (reference) => {
      const { references } = this.context.scopes;
      if (!references.has(reference) || reference.type !== 'Identifier') {
        return undefined;
      }
      const binding = references.get(reference);
      return binding ? this.constantOf(binding) : globalValue(reference.name);
    };
  }

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /**
   * The value of a `const`, or of a `let` nothing writes to.
   *
   * A reference that runs before its declaration throws at runtime, and
   * folding turns it into the value. Minifiers make the same trade.
   */
  private constantOf(binding: Binding): Const | undefined {
    const cached = this.constants.get(binding);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    let value: Const | undefined;
    const { declaration } = binding;
    // `var` is excluded. A read before its declaration sees `undefined`
    // rather than throwing, so folding it to the initializer would change the result.
    if (
      (binding.kind === 'const' || binding.kind === 'let') &&
      !binding.mutated &&
      declaration.type === 'VariableDeclarator' &&
      declaration.id === binding.identifier &&
      declaration.init &&
      !this.evaluating.has(binding)
    ) {
      this.evaluating.add(binding);
      value = evaluate(declaration.init, this.lookup);
      this.evaluating.delete(binding);
    }
    this.constants.set(binding, value ?? null);
    return value;
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
      const discarded = isSideEffectFree(node.left) ? undefined : node.left;
      this.replace(node, this.keepAfter(node, discarded, node.right));
    }
  }

  private foldConditional(node: ConditionalExpression): void {
    const test = truthiness(node.test, this.lookup);
    if (test === undefined) {
      return;
    }
    const discarded = isSideEffectFree(node.test) ? undefined : node.test;
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
    let identity: string | undefined;
    if (!binding) {
      identity = name.name;
    } else if (
      binding.kind === 'import' &&
      binding.source !== undefined &&
      this.context.options.moduleSources.includes(binding.source)
    ) {
      identity = binding.imported;
    }
    if (identity === undefined || !this.context.options.builtIns.has(identity)) {
      return undefined;
    }
    return identity;
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
    if (!empty || !isSideEffectFree(expression)) {
      return undefined;
    }
    return this.fallback(element);
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
      if (isFilteredText(child)) {
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
  private foldDynamic(element: JSXElement): Fold | undefined {
    const component = findAttribute(element, 'component');
    if (!component?.value) {
      return undefined;
    }
    let tag: string | undefined;
    const { value } = component;
    if (value.type === 'Literal') {
      tag = value.value;
    } else if (
      value.type === 'JSXExpressionContainer' &&
      value.expression.type !== 'JSXEmptyExpression'
    ) {
      const result = evaluate(value.expression, this.lookup);
      if (typeof result?.value === 'string') {
        tag = result.value;
      }
    }
    if (tag === undefined || !isIntrinsicTag(tag)) {
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
        const significant = resolved.children.filter((child) => !isFilteredText(child));
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
