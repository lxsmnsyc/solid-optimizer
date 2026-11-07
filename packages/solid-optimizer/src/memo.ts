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
 * Solid's `children` helper is a memo too. It resolves the children once,
 * caches them, and flattens them in a second memo. When the children are JSX,
 * nothing they read at the top makes either memo run again, and inserting the
 * JSX directly resolves it the same way. So a `children(() => <jsx />)` read
 * once as an element's child becomes that JSX, which joins the template:
 *
 * ```jsx
 * const c = children(() => <b>x</b>);
 * return <div>{c()}</div>;
 * ```
 *
 * becomes `<div><b>x</b></div>`.
 *
 * A signal that nothing writes is a constant too. When its setter is left
 * out or never referenced, and its initial value is a literal, every read
 * becomes the literal:
 *
 * ```jsx
 * const [size] = createSignal(3);
 * return <p>{size()}</p>;
 * ```
 *
 * becomes `<p>{3}</p>`. A signal with a value that is not a function takes no
 * owner and no hydration id, so removing it changes nothing else.
 *
 * A plain arrow that only returns an expression, like a derived accessor,
 * has no cache and no owner, so each call already runs its body again. The
 * calls can become the body:
 *
 * ```jsx
 * const label = () => (props.open ? 'Close' : 'Open');
 * return <button>{label()}</button>;
 * ```
 *
 * becomes `<button>{(props.open ? 'Close' : 'Open')}</button>`. With more than
 * one call, the body is copied only when the copies are no larger than the
 * arrow and its calls.
 *
 * # Accepted differences
 *
 * - The computation first runs when its reader first runs, instead of when
 *   the memo is created.
 * - The memo no longer takes a slot in the owner tree, which shifts the
 *   hydration keys after it. A server build and its client build must
 *   compile with the same options.
 * - A call that runs before the declaration, from a hoisted function the
 *   declaration comes before, throws on the original and returns the value
 *   on the output.
 */
import type {
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  Function as FunctionNode,
  JSXExpressionContainer,
  Node,
  ObjectExpression,
  VariableDeclarator,
} from 'oxc-parser';
import { isFunctionNode, isIntrinsicTag, isPrimary, unwrap } from './ast';
import type { PassContext } from './context';
import { getText, recordSkip, solidExport } from './context';
import { usesFunctionContext } from './inline';
import type { Binding } from './scope';
import { lookup, scopeAt } from './scope';
import { compactLength } from './size';

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
 * Global constructors whose instances are never thenable or async iterable.
 */
const SYNC_CONSTRUCTORS = new Set([
  'Array',
  'Date',
  'Error',
  'Map',
  'RegExp',
  'Set',
  'URL',
  'URLSearchParams',
  'WeakMap',
  'WeakSet',
]);

/**
 * Whether an object literal can have a `then` method or `Symbol.asyncIterator`,
 * its own or from a `__proto__` it sets.
 */
function mayBeThenable(node: ObjectExpression): boolean {
  for (const property of node.properties) {
    if (property.type === 'SpreadElement' || property.computed) {
      return true;
    }
    const { key } = property;
    let name: unknown;
    if (key.type === 'Identifier') {
      name = key.name;
    } else if ('value' in key) {
      name = key.value;
    }
    if (name === 'then' || name === '__proto__') {
      return true;
    }
  }
  return false;
}

/**
 * Whether evaluating `node` always creates a new value, which reference
 * equality never finds equal to the last one. The value is never a promise
 * or an async iterable, which a memo waits for and an inlined read does not.
 * `isGlobal` tells whether a name is one the module does not declare.
 */
function isFresh(node: Node, isGlobal: (node: Node) => boolean): boolean {
  switch (node.type) {
    case 'ArrayExpression':
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'JSXElement':
    case 'JSXFragment':
      return true;
    case 'ObjectExpression':
      return !mayBeThenable(node);
    case 'NewExpression':
      return (
        node.callee.type === 'Identifier' &&
        SYNC_CONSTRUCTORS.has(node.callee.name) &&
        isGlobal(node.callee)
      );
    case 'ParenthesizedExpression':
      return isFresh(node.expression, isGlobal);
    case 'ConditionalExpression':
      return isFresh(node.consequent, isGlobal) && isFresh(node.alternate, isGlobal);
    case 'SequenceExpression': {
      const last = node.expressions.at(-1);
      return last !== undefined && isFresh(last, isGlobal);
    }
    default:
      return false;
  }
}

/**
 * Whether `node` evaluates to a value that is never a promise or an async
 * iterable. A memo waits for one of those, and an inlined read does not.
 */
function isSync(node: Node, isGlobal: (node: Node) => boolean): boolean {
  switch (node.type) {
    case 'Literal':
    case 'TemplateLiteral':
    case 'UnaryExpression':
    case 'UpdateExpression':
    case 'BinaryExpression':
      return true;
    case 'ParenthesizedExpression':
      return isSync(node.expression, isGlobal);
    case 'ConditionalExpression':
      return isSync(node.consequent, isGlobal) && isSync(node.alternate, isGlobal);
    case 'LogicalExpression':
      return isSync(node.left, isGlobal) && isSync(node.right, isGlobal);
    case 'SequenceExpression': {
      const last = node.expressions.at(-1);
      return last !== undefined && isSync(last, isGlobal);
    }
    default:
      return isFresh(node, isGlobal);
  }
}

/**
 * The expression a compute function returns, when that is all it does.
 */
type MemoKind = 'createMemo' | 'children';

/**
 * The text of an expression that always gives the same primitive: a literal
 * other than a regular expression, a template literal without expressions,
 * or a negated number.
 */
function constantText(context: PassContext, node: Expression): string | undefined {
  const expression = unwrap(node);
  switch (expression.type) {
    case 'Literal':
      return 'regex' in expression ? undefined : getText(context, expression);
    case 'TemplateLiteral':
      return expression.expressions.length === 0 ? getText(context, expression) : undefined;
    case 'UnaryExpression':
      return expression.operator === '-' &&
        expression.argument.type === 'Literal' &&
        typeof expression.argument.value === 'number'
        ? getText(context, expression)
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

  /** Ranges of the source rewritten so far in this run. */
  private readonly edited: [number, number][] = [];

  constructor(private readonly context: PassContext) {}

  /** Why the last memo was turned down, for the report. Empty for a call that is not a memo. */
  private reason = '';

  /** Whether a callee is Solid's `createMemo` or `children`. */
  private memoKind(callee: Node): MemoKind | undefined {
    if (callee.type !== 'Identifier') {
      return undefined;
    }
    const binding = this.context.scopes.references.get(callee);
    const identity = binding ? solidExport(binding, this.context.options) : undefined;
    return identity === 'createMemo' || identity === 'children' ? identity : undefined;
  }

  /**
   * The expression a memo's computation returns, and whether `equals: false`
   * makes it notify on every run.
   */
  private computation(
    declarator: VariableDeclarator,
  ): { expression: Expression; alwaysNotifies: boolean; kind: MemoKind } | undefined {
    const init = declarator.init ? unwrap(declarator.init) : undefined;
    const kind = init?.type === 'CallExpression' ? this.memoKind(init.callee) : undefined;
    if (init?.type !== 'CallExpression' || kind === undefined) {
      return undefined;
    }
    const args = init.arguments;
    if (kind === 'children' && args.length > 1) {
      this.reason = 'memo-options';
      return undefined;
    }
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
    return { expression, alwaysNotifies, kind };
  }

  /**
   * Replaces every read of a memo or signal whose value is a literal with the
   * literal. Each reference has to be a call after the declaration, since a
   * call before it would throw.
   */
  private inlineConstant(
    declarator: VariableDeclarator,
    binding: Binding,
    text: string,
    kind: 'memo' | 'signal' = 'memo',
  ): true | undefined {
    const statement = this.context.parents.get(declarator);
    if (statement?.type !== 'VariableDeclaration' || statement.declarations.length !== 1) {
      this.reason = `${kind}-declaration`;
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
        this.reason = `${kind}-constant`;
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
      this.edited.push([call.start, call.end]);
    }
    this.context.s.remove(statement.start, statement.end);
    this.edited.push([statement.start, statement.end]);
    this.changed = true;
    return true;
  }

  /**
   * The function a node runs in.
   */
  private findEnclosingFunction(node: Node): Node | undefined {
    let current = this.context.parents.get(node);
    while (current && !isFunctionNode(current)) {
      current = this.context.parents.get(current);
    }
    return current;
  }

  /** The JSX expression container a call is the whole of. */
  private findContainer(call: Node): JSXExpressionContainer | undefined {
    let parent = this.context.parents.get(call);
    while (parent?.type === 'ParenthesizedExpression') {
      parent = this.context.parents.get(parent);
    }
    return parent?.type === 'JSXExpressionContainer' ? parent : undefined;
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
        this.getBuiltIn(element.openingElement.name) !== tag ||
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

  private getBuiltIn(name: Node): string | undefined {
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
          return this.findEnclosingFunction(parent) === fn && !this.inLoop(parent, fn);
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
    const { expression, alwaysNotifies, kind } = found;
    if (kind === 'children') {
      // Only JSX is resolved the same by `insert`, and never makes the helper run again.
      const root = unwrap(expression);
      if (root.type !== 'JSXElement' && root.type !== 'JSXFragment') {
        this.reason = 'children-dynamic';
        return undefined;
      }
    } else {
      const constant = constantText(this.context, expression);
      if (constant !== undefined) {
        return this.inlineConstant(declarator, binding, constant);
      }
      const isGlobal = (node: Node): boolean =>
        this.context.scopes.references.get(node) === undefined;
      // A memo whose result can equal its last one stops updates, which is what it is for.
      if (!alwaysNotifies && !isFresh(expression, isGlobal)) {
        return undefined;
      }
      // A memo waits for a promise or an async iterable. The insert an inlined
      // read becomes takes the value as it is.
      if (alwaysNotifies && !isSync(expression, isGlobal)) {
        this.reason = 'memo-async';
        return undefined;
      }
    }
    if (binding.references.length !== 1) {
      this.reason = 'memo-reads';
      return undefined;
    }
    const statement = this.context.parents.get(declarator);
    const fn = this.findEnclosingFunction(declarator);
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
    // The resolved children are inserted, so the read has to be a child, not an attribute.
    const container = this.findContainer(call);
    const owner = container ? this.context.parents.get(container) : undefined;
    if (
      kind === 'children' &&
      (!container || (owner?.type !== 'JSXElement' && owner?.type !== 'JSXFragment'))
    ) {
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
    if (kind === 'children' && container) {
      // The JSX takes the place of its container, so it joins the template around it.
      this.context.s.overwrite(container.start, container.end, getText(this.context, expression));
      this.edited.push([container.start, container.end]);
    } else {
      // The read sits in a JSX container, which takes any expression.
      this.context.s.overwrite(call.start, call.end, getText(this.context, expression));
      this.edited.push([call.start, call.end]);
    }
    this.context.s.remove(statement.start, statement.end);
    this.edited.push([statement.start, statement.end]);
    this.changed = true;
    return true;
  }

  /**
   * The literal a signal always holds: `const [get] = createSignal(literal)`,
   * or `const [get, set] = ...` with nothing referencing `set`. Options can
   * change what a read does, such as `unobserved`, so a signal with options
   * stays.
   */
  private signalConstant(declarator: VariableDeclarator, binding: Binding): string | undefined {
    const pattern = declarator.id;
    const init = declarator.init ? unwrap(declarator.init) : undefined;
    if (
      pattern.type !== 'ArrayPattern' ||
      pattern.elements.at(0) !== binding.identifier ||
      pattern.elements.length > 2 ||
      init?.type !== 'CallExpression' ||
      init.callee.type !== 'Identifier' ||
      init.arguments.length !== 1
    ) {
      return undefined;
    }
    const callee = this.context.scopes.references.get(init.callee);
    if (!callee || solidExport(callee, this.context.options) !== 'createSignal') {
      return undefined;
    }
    const value = init.arguments.at(0);
    if (!value || value.type === 'SpreadElement') {
      return undefined;
    }
    // Other modules can read an exported getter.
    const statement = this.context.parents.get(declarator);
    if (statement && this.context.parents.get(statement)?.type === 'ExportNamedDeclaration') {
      return undefined;
    }
    const setter = pattern.elements.at(1);
    if (setter) {
      const setterBinding =
        setter.type === 'Identifier' ? binding.scope.bindings.get(setter.name) : undefined;
      if (setterBinding?.identifier !== setter || setterBinding.references.length > 0) {
        return undefined;
      }
    }
    return constantText(this.context, value);
  }

  private tryInlineSignal(declarator: VariableDeclarator, binding: Binding): void {
    const text = this.signalConstant(declarator, binding);
    if (text === undefined) {
      return;
    }
    this.reason = '';
    if (this.inlineConstant(declarator, binding, text, 'signal') === undefined) {
      recordSkip(this.context, 'memos', this.reason, binding.name);
    }
  }

  /**
   * Replaces every call of `const name = () => expression` with the
   * expression. Each reference has to be a call with no arguments after the
   * declaration, and every name in the body has to mean the same at the call.
   */
  private tryInlineArrow(declarator: VariableDeclarator, binding: Binding): void {
    const fn = declarator.init ? unwrap(declarator.init) : undefined;
    if (fn?.type !== 'ArrowFunctionExpression' || fn.async || fn.params.length > 0) {
      return;
    }
    const body = returnedExpression(fn);
    const statement = this.context.parents.get(declarator);
    if (
      !body ||
      statement?.type !== 'VariableDeclaration' ||
      statement.declarations.length !== 1 ||
      // Other modules can call an exported arrow.
      this.context.parents.get(statement)?.type === 'ExportNamedDeclaration'
    ) {
      return;
    }
    const calls: CallExpression[] = [];
    for (const reference of binding.references) {
      const call = this.context.parents.get(reference);
      if (
        call?.type !== 'CallExpression' ||
        call.callee !== reference ||
        call.optional ||
        call.arguments.length > 0 ||
        call.start < declarator.end
      ) {
        // The arrow is used as a value, like an event handler. That is not a derivation.
        return;
      }
      // `l()()` calls the result with no `this`, but `(a.b)()` passes `a`, and
      // `delete (a.b)` deletes what `delete l()` leaves alone.
      const parent = this.context.parents.get(call);
      if (
        (parent?.type === 'CallExpression' && parent.callee === call) ||
        (parent?.type === 'TaggedTemplateExpression' && parent.tag === call) ||
        (parent?.type === 'UnaryExpression' && parent.operator === 'delete')
      ) {
        return;
      }
      calls.push(call);
    }
    if (calls.length === 0) {
      return;
    }
    // The body is copied from the source, so it must not hold an edit from this run.
    // The next round sees the edit.
    for (const [start, end] of this.edited) {
      if (start < statement.end && end > statement.start) {
        return;
      }
    }
    const text = getText(this.context, body);
    // Minified, the arrow costs `const a=()=>body;`, 13 characters besides the
    // body, and each call `a()` costs 3. Copying adds the body to every call
    // but one, and removes the rest.
    const length = compactLength(text);
    if ((calls.length - 1) * length > calls.length * 3 + 13) {
      return;
    }
    if (usesFunctionContext(this.context, fn)) {
      return;
    }
    for (const call of calls) {
      if (!this.resolvesSameAt(body, call, binding)) {
        return;
      }
    }
    const bare = isPrimary(body);
    for (const call of calls) {
      const parent = this.context.parents.get(call);
      const inContainer =
        parent?.type === 'JSXExpressionContainer' && body.type !== 'SequenceExpression';
      this.context.s.overwrite(call.start, call.end, bare || inContainer ? text : `(${text})`);
      this.edited.push([call.start, call.end]);
    }
    this.context.s.remove(statement.start, statement.end);
    this.edited.push([statement.start, statement.end]);
    this.changed = true;
  }

  run(): void {
    for (const scope of new Set(this.context.scopes.scopes.values())) {
      for (const binding of scope.bindings.values()) {
        const { declaration } = binding;
        if (
          binding.kind !== 'const' ||
          binding.mutated ||
          declaration.type !== 'VariableDeclarator'
        ) {
          continue;
        }
        if (declaration.id.type === 'ArrayPattern') {
          // A signal takes no owner, so one outside any function works the same.
          this.tryInlineSignal(declaration, binding);
        } else if (declaration.id === binding.identifier) {
          // An arrow has no owner, so one outside any function works the same.
          this.tryInlineArrow(declaration, binding);
          // A memo outside any function has no owner, and disposes differently.
          if (scope.parent !== undefined) {
            this.tryInline(declaration, binding);
          }
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
