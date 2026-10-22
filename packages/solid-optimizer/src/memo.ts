/**
 * The memo pass: inlines a `createMemo` whose memoization does nothing.
 *
 * A memo does two things for its readers. It runs its computation once and
 * shares the result, and it only notifies them when the result changes. A
 * memo that returns a new object, array, function, or JSX element on every
 * run, or that sets `equals: false`, notifies on every run, so the second
 * part never applies. When such a memo is also read exactly once, the first
 * part does not apply either, and the read can run the computation itself:
 *
 * ```jsx
 * const style = createMemo(() => ({ color: color() }));
 * return <p style={style()} />;
 * ```
 *
 * becomes `<p style={{ color: color() }} />`.
 *
 * The read has to be the whole of a tracked expression, so it depends on
 * exactly what the memo depended on and reruns exactly as often. It also has
 * to run once each time the function holding the memo runs, so a read in a
 * callback, a loop, or a component's children stays a read of the memo.
 *
 * A memo whose computation folds to a literal reads no signals, so it never
 * runs again and its value never changes. Every read of it becomes the
 * literal, however many there are:
 *
 * ```jsx
 * const size = createMemo(() => 3);
 * return <p>{size() * 2}</p>;
 * ```
 *
 * becomes `<p>{3 * 2}</p>`, which the next fold turns into `6`.
 *
 * # Accepted differences
 *
 * - The computation first runs when its reader first runs, instead of when
 *   the memo is created.
 * - The memo no longer takes a slot in the owner tree, which shifts the
 *   hydration keys after it. A server build and its client build must
 *   compile with the same options.
 */
import type {
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  Function as FunctionNode,
  Node,
  VariableDeclarator,
} from 'oxc-parser';
import { isFunctionNode, isIntrinsicTag, unwrap } from './ast';
import type { PassContext } from './context';
import { recordSkip, solidExport, textOf } from './context';
import { usesFunctionContext } from './inline';
import type { Binding } from './scope';
import { lookup, scopeAt } from './scope';

/**
 * Props of Solid's built-in components that are read inside a memo, once per update.
 */
const TRACKED_PROPS = new Map([
  ['Show', 'when'],
  ['Match', 'when'],
  ['For', 'each'],
  ['Repeat', 'count'],
]);

/**
 * Whether evaluating `node` always creates a new value, which reference
 * equality never finds equal to the last one.
 */
function isFresh(node: Node): boolean {
  switch (node.type) {
    case 'ObjectExpression':
    case 'ArrayExpression':
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'ClassExpression':
    case 'NewExpression':
    case 'JSXElement':
    case 'JSXFragment':
      return true;
    case 'ParenthesizedExpression':
      return isFresh(node.expression);
    case 'ConditionalExpression':
      return isFresh(node.consequent) && isFresh(node.alternate);
    case 'SequenceExpression': {
      const last = node.expressions.at(-1);
      return last !== undefined && isFresh(last);
    }
    default:
      return false;
  }
}

/**
 * The expression a compute function returns, when that is all it does.
 */
/**
 * The text of an expression that always gives the same primitive: a literal
 * other than a regular expression, a template literal without expressions,
 * or a negated number.
 */
function constantText(context: PassContext, node: Expression): string | undefined {
  const expression = unwrap(node);
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

function returnedExpression(fn: FunctionNode | ArrowFunctionExpression): Expression | undefined {
  if (fn.async || fn.generator || fn.params.length > 0 || !fn.body) {
    return undefined;
  }
  if (fn.body.type !== 'BlockStatement') {
    return fn.body;
  }
  const statements = fn.body.body;
  const statement = statements.at(0);
  if (statements.length !== 1 || statement?.type !== 'ReturnStatement' || !statement.argument) {
    return undefined;
  }
  return statement.argument;
}

class MemoInliner {
  changed = false;

  constructor(private readonly context: PassContext) {}

  /** Why the last memo was turned down, for the report. Empty for a call that is not a memo. */
  private reason = '';

  private isCreateMemo(callee: Node): boolean {
    if (callee.type !== 'Identifier') {
      return false;
    }
    const binding = this.context.scopes.references.get(callee);
    return binding !== undefined && solidExport(binding, this.context.options) === 'createMemo';
  }

  /**
   * The expression a memo's computation returns, and whether `equals: false`
   * makes it notify on every run.
   */
  private computation(
    declarator: VariableDeclarator,
  ): { expression: Expression; alwaysNotifies: boolean } | undefined {
    const init = declarator.init ? unwrap(declarator.init) : undefined;
    if (init?.type !== 'CallExpression' || !this.isCreateMemo(init.callee)) {
      return undefined;
    }
    const args = init.arguments;
    const compute = args.at(0);
    const options = args.at(1);
    if (args.length > 2 || compute === undefined || compute.type === 'SpreadElement') {
      this.reason = 'memo-computation';
      return undefined;
    }
    const fn = unwrap(compute);
    if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') {
      this.reason = 'memo-computation';
      return undefined;
    }
    const expression = returnedExpression(fn);
    if (!expression) {
      this.reason = 'memo-computation';
      return undefined;
    }
    let alwaysNotifies = false;
    if (options !== undefined) {
      // Only `equals: false` is understood. Any other option changes what the memo does.
      if (options.type !== 'ObjectExpression' || options.properties.length !== 1) {
        this.reason = 'memo-options';
        return undefined;
      }
      const property = options.properties.at(0);
      if (
        property?.type !== 'Property' ||
        property.computed ||
        property.key.type !== 'Identifier' ||
        property.key.name !== 'equals' ||
        property.value.type !== 'Literal' ||
        property.value.value !== false
      ) {
        this.reason = 'memo-options';
        return undefined;
      }
      alwaysNotifies = true;
    }
    return { expression, alwaysNotifies };
  }

  /**
   * Replaces every read of a memo whose computation is a literal with the
   * literal. Each reference has to be a call after the declaration, since a
   * call before it would throw.
   */
  private inlineConstant(
    declarator: VariableDeclarator,
    binding: Binding,
    text: string,
  ): true | undefined {
    const statement = this.context.parents.get(declarator);
    if (statement?.type !== 'VariableDeclaration' || statement.declarations.length !== 1) {
      this.reason = 'memo-declaration';
      return undefined;
    }
    const calls: CallExpression[] = [];
    for (const reference of binding.references) {
      const call = this.context.parents.get(reference);
      if (
        call?.type !== 'CallExpression' ||
        call.callee !== reference ||
        call.arguments.length > 0 ||
        call.start < declarator.end
      ) {
        this.reason = 'memo-constant';
        return undefined;
      }
      calls.push(call);
    }
    for (const call of calls) {
      // `3.toFixed()` and `-1 ** 2` do not parse, so a literal under an operator or a member gets parentheses.
      const parent = this.context.parents.get(call);
      const bare =
        parent?.type === 'JSXExpressionContainer' ||
        parent?.type === 'VariableDeclarator' ||
        parent?.type === 'ReturnStatement' ||
        parent?.type === 'ArrayExpression' ||
        parent?.type === 'Property' ||
        (parent?.type === 'CallExpression' && parent.callee !== call);
      this.context.s.overwrite(call.start, call.end, bare ? text : `(${text})`);
    }
    this.context.s.remove(statement.start, statement.end);
    this.changed = true;
    return true;
  }

  /**
   * The function a node runs in.
   */
  private functionOf(node: Node): Node | undefined {
    let current = this.context.parents.get(node);
    while (current && !isFunctionNode(current)) {
      current = this.context.parents.get(current);
    }
    return current;
  }

  /**
   * Whether a call is the whole of an expression that Solid tracks, and that
   * runs once each time `fn` runs.
   */
  private isSingleTrackedRead(call: Node, fn: Node): boolean {
    let node = call;
    let parent = this.context.parents.get(node);
    while (parent?.type === 'ParenthesizedExpression') {
      node = parent;
      parent = this.context.parents.get(node);
    }
    if (parent?.type !== 'JSXExpressionContainer') {
      return false;
    }
    const container = parent;
    const owner = this.context.parents.get(container);
    let element: Node | undefined;
    if (owner?.type === 'JSXFragment') {
      element = owner;
    } else if (owner?.type === 'JSXElement') {
      // A child of an element is inserted, which tracks it. A child of a
      // component is a prop, which the component can read any number of times.
      const { name } = owner.openingElement;
      if (name.type !== 'JSXIdentifier' || !isIntrinsicTag(name.name)) {
        return false;
      }
      element = owner;
    } else if (owner?.type === 'JSXAttribute' && owner.name.type === 'JSXIdentifier') {
      const attribute = owner.name.name;
      const opening = this.context.parents.get(owner);
      element = opening ? this.context.parents.get(opening) : undefined;
      if (element?.type !== 'JSXElement' || element.openingElement.name.type !== 'JSXIdentifier') {
        return false;
      }
      const tag = element.openingElement.name.name;
      if (isIntrinsicTag(tag)) {
        // An event handler or ref is read once and never tracked.
        if (attribute.startsWith('on') || attribute === 'ref') {
          return false;
        }
      } else if (
        this.builtInOf(element.openingElement.name) !== tag ||
        TRACKED_PROPS.get(tag) !== attribute
      ) {
        // A component can read a prop any number of times.
        return false;
      }
    } else {
      return false;
    }
    return this.isStaticJSX(element, fn);
  }

  private builtInOf(name: Node): string | undefined {
    if (name.type !== 'JSXIdentifier') {
      return undefined;
    }
    const { references } = this.context.scopes;
    if (!references.has(name)) {
      return undefined;
    }
    const binding = references.get(name);
    return binding ? solidExport(binding, this.context.options) : name.name;
  }

  /**
   * Whether JSX is created once each time `fn` runs: it sits in JSX that `fn`
   * returns, with only intrinsic elements and fragments around it.
   */
  private isStaticJSX(element: Node, fn: Node): boolean {
    let node = element;
    for (;;) {
      const parent = this.context.parents.get(node);
      if (!parent) {
        return false;
      }
      if (parent === fn) {
        // An arrow function's expression body.
        return true;
      }
      switch (parent.type) {
        case 'JSXElement': {
          const { name } = parent.openingElement;
          if (name.type !== 'JSXIdentifier' || !isIntrinsicTag(name.name)) {
            return false;
          }
          break;
        }
        case 'JSXFragment':
        case 'ParenthesizedExpression':
          break;
        case 'ReturnStatement':
          return this.functionOf(parent) === fn && !this.inLoop(parent, fn);
        default:
          return false;
      }
      node = parent;
    }
  }

  private inLoop(node: Node, fn: Node): boolean {
    let current = this.context.parents.get(node);
    while (current && current !== fn) {
      if (
        current.type === 'ForStatement' ||
        current.type === 'ForInStatement' ||
        current.type === 'ForOfStatement' ||
        current.type === 'WhileStatement' ||
        current.type === 'DoWhileStatement'
      ) {
        return true;
      }
      current = this.context.parents.get(current);
    }
    return false;
  }

  /**
   * Whether every name in `expression` means the same at `site`.
   */
  private resolvesSameAt(expression: Node, site: Node, memo: Binding): boolean {
    const scope = scopeAt(this.context.scopes, this.context.parents, site);
    for (const [reference, binding] of this.context.scopes.references) {
      if (reference.start < expression.start || reference.end > expression.end) {
        continue;
      }
      if (binding === memo) {
        return false;
      }
      // A name declared inside the computation, like a callback's parameter, moves with it.
      if (
        binding !== undefined &&
        binding.identifier.start >= expression.start &&
        binding.identifier.end <= expression.end
      ) {
        continue;
      }
      if (
        (reference.type === 'Identifier' || reference.type === 'JSXIdentifier') &&
        lookup(scope, reference.name) !== binding
      ) {
        return false;
      }
    }
    return true;
  }

  private tryInline(declarator: VariableDeclarator, binding: Binding): void {
    this.reason = '';
    if (this.inline(declarator, binding) === undefined && this.reason !== '') {
      recordSkip(this.context, 'memos', this.reason, binding.name);
    }
  }

  private inline(declarator: VariableDeclarator, binding: Binding): true | undefined {
    const found = this.computation(declarator);
    if (!found) {
      return undefined;
    }
    const { expression, alwaysNotifies } = found;
    const constant = constantText(this.context, expression);
    if (constant !== undefined) {
      return this.inlineConstant(declarator, binding, constant);
    }
    // A memo whose result can equal its last one stops updates, which is what it is for.
    if (!alwaysNotifies && !isFresh(expression)) {
      return undefined;
    }
    if (binding.references.length !== 1) {
      this.reason = 'memo-reads';
      return undefined;
    }
    const statement = this.context.parents.get(declarator);
    const fn = this.functionOf(declarator);
    if (statement?.type !== 'VariableDeclaration' || statement.declarations.length !== 1 || !fn) {
      this.reason = 'memo-declaration';
      return undefined;
    }
    const reference = binding.references.at(0);
    const call = reference ? this.context.parents.get(reference) : undefined;
    if (call?.type !== 'CallExpression' || call.callee !== reference || call.arguments.length > 0) {
      this.reason = 'memo-read';
      return undefined;
    }
    if (!this.isSingleTrackedRead(call, fn)) {
      this.reason = 'memo-read-place';
      return undefined;
    }
    if (
      !this.resolvesSameAt(expression, call, binding) ||
      usesFunctionContext(this.context, expression)
    ) {
      this.reason = 'memo-scope';
      return undefined;
    }
    // The read sits in a JSX container, which takes any expression.
    this.context.s.overwrite(call.start, call.end, textOf(this.context, expression));
    this.context.s.remove(statement.start, statement.end);
    this.changed = true;
    return true;
  }

  run(): void {
    for (const scope of new Set(this.context.scopes.scopes.values())) {
      // A memo outside any function has no owner, and disposes differently.
      if (scope.parent === undefined) {
        continue;
      }
      for (const binding of scope.bindings.values()) {
        const { declaration } = binding;
        if (
          binding.kind === 'const' &&
          !binding.mutated &&
          declaration.type === 'VariableDeclarator' &&
          declaration.id === binding.identifier
        ) {
          this.tryInline(declaration, binding);
        }
      }
    }
  }
}

/**
 * Runs the memo pass over a parsed program. Returns whether anything changed.
 */
export function inlineMemos(context: PassContext): boolean {
  const inliner = new MemoInliner(context);
  inliner.run();
  return inliner.changed;
}
