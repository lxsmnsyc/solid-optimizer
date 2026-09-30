/**
 * The provider pass: removes context providers whose reads are all visible.
 *
 * In Solid 2.0, a context is its own provider component. The provider reads
 * `props.value` once, untracked, when it is created, and every
 * `useContext(Ctx)` under it returns that value. When every code path that
 * can run under a provider is visible, each read can take the value
 * directly, and the provider only costs a component call, a root owner, and
 * a template boundary:
 *
 * ```jsx
 * <Theme value="dark">
 *   <span>{useContext(Theme)}</span>
 * </Theme>
 * ```
 *
 * becomes `<><span>{"dark"}</span></>`.
 *
 * Most reads sit in a consumer component's statements. The inline pass
 * moves those consumers out through a closed provider and replaces their
 * reads, and this pass removes the provider once nothing under it is a
 * component anymore.
 *
 * # Accepted differences
 *
 * - The provider's root owner is gone, which shifts the hydration keys
 *   after it. A server build and its client build must compile with the
 *   same options.
 * - A getter defined by the app, other than on a component's props, that
 *   calls `useContext` is not seen.
 */
import type {
  CallExpression,
  Expression,
  JSXAttribute,
  JSXElement,
  MemberExpression,
  Node,
  ObjectExpression,
} from 'oxc-parser';
import { forEachChild, isFunctionNode, isIntrinsicTag, unwrap } from './ast';
import type { PassContext } from './context';
import { isConstantDeclaration, solidExport } from './context';
import type { Binding } from './scope';
import { lookup, scopeAt } from './scope';
import { evaluate, isSideEffectFree, literalText } from './value';

/**
 * Solid's primitives that run no code of the app, except the functions
 * passed to them. Those functions are checked like any other code.
 */
export const CONTEXT_SAFE_PRIMITIVES = [
  'createSignal',
  'createMemo',
  'createEffect',
  'createRenderEffect',
  'createStore',
  'createProjection',
  'createOptimistic',
  'onCleanup',
  'onSettled',
  'untrack',
  'useContext',
  'flush',
  'mapArray',
  'repeat',
  'merge',
  'omit',
];

/** Primitives that return a getter and a setter, as `[get, set]`. */
const ACCESSOR_PAIRS = new Set(['createSignal', 'createStore', 'createOptimistic']);

export interface Provider {
  readonly element: JSXElement;
  /** The top-level `createContext()` binding the tag refers to. */
  readonly context: Binding;
  readonly value: Expression;
}

/**
 * The provider a JSX element creates: a tag that refers to a top-level
 * `createContext(...)` from Solid, nothing writes to, with one `value`
 * attribute holding a value that is never `undefined`.
 *
 * `useContext` throws when the value and the default are both `undefined`,
 * so a value that could be `undefined` keeps its provider.
 */
export function providerOf(context: PassContext, element: JSXElement): Provider | undefined {
  const binding = contextBinding(context, element.openingElement.name);
  if (!binding || element.openingElement.selfClosing) {
    return undefined;
  }
  const { attributes } = element.openingElement;
  const attribute = attributes.at(0);
  if (
    attributes.length !== 1 ||
    attribute?.type !== 'JSXAttribute' ||
    attribute.name.type !== 'JSXIdentifier' ||
    attribute.name.name !== 'value' ||
    !attribute.value
  ) {
    return undefined;
  }
  let value: Expression;
  if (attribute.value.type === 'Literal') {
    value = attribute.value;
  } else if (
    attribute.value.type === 'JSXExpressionContainer' &&
    attribute.value.expression.type !== 'JSXEmptyExpression'
  ) {
    value = attribute.value.expression;
  } else {
    return undefined;
  }
  if (!isDefined(context, value, 0)) {
    return undefined;
  }
  return { element, context: binding, value };
}

/**
 * The top-level context binding a tag or identifier refers to.
 */
export function contextBinding(context: PassContext, name: Node): Binding | undefined {
  if (name.type !== 'JSXIdentifier' && name.type !== 'Identifier') {
    return undefined;
  }
  const binding = context.scopes.references.get(name);
  if (!binding || binding.mutated || binding.scope.parent !== undefined) {
    return undefined;
  }
  const { declaration } = binding;
  if (
    declaration.type !== 'VariableDeclarator' ||
    declaration.id !== binding.identifier ||
    !isConstantDeclaration(binding, context.options) ||
    !declaration.init
  ) {
    return undefined;
  }
  const init = unwrap(declaration.init);
  return init.type === 'CallExpression' && solidCallee(context, init) === 'createContext'
    ? binding
    : undefined;
}

/**
 * The Solid export a call calls, like `createSignal`.
 */
export function solidCallee(context: PassContext, call: CallExpression): string | undefined {
  const callee = unwrap(call.callee);
  if (callee.type !== 'Identifier') {
    return undefined;
  }
  const binding = context.scopes.references.get(callee);
  return binding ? solidExport(binding, context.options) : undefined;
}

/**
 * Whether evaluating `node` never gives `undefined`.
 */
function isDefined(context: PassContext, node: Expression, depth: number): boolean {
  const expression = unwrap(node);
  switch (expression.type) {
    case 'ObjectExpression':
    case 'ArrayExpression':
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'ClassExpression':
    case 'NewExpression':
    case 'TemplateLiteral':
    case 'JSXElement':
    case 'JSXFragment':
      return true;
    case 'Identifier': {
      const binding = context.scopes.references.get(expression);
      if (!binding || binding.mutated || depth > 2) {
        return false;
      }
      if (binding.kind === 'function' || binding.kind === 'class' || isAccessor(context, binding)) {
        return true;
      }
      const { declaration } = binding;
      return (
        isConstantDeclaration(binding, context.options) &&
        declaration.type === 'VariableDeclarator' &&
        declaration.id === binding.identifier &&
        declaration.init !== null &&
        isDefined(context, declaration.init, depth + 1)
      );
    }
    default: {
      return evaluate(expression, () => undefined)?.value !== undefined;
    }
  }
}

/**
 * The text a read of a provider's value can be replaced with at `site`: a
 * literal, or a binding that never changes and means the same there.
 * `undefined` when the value has to be stored first.
 */
export function stableValueText(
  context: PassContext,
  provider: Provider,
  site: Node,
): string | undefined {
  const value = unwrap(provider.value);
  const constant = evaluate(value, () => undefined);
  if (constant) {
    return literalText(constant.value);
  }
  if (value.type !== 'Identifier') {
    return undefined;
  }
  const binding = context.scopes.references.get(value);
  if (!binding || binding.mutated) {
    return undefined;
  }
  const unchanging =
    binding.kind === 'function' ||
    binding.kind === 'class' ||
    binding.kind === 'import' ||
    isConstantDeclaration(binding, context.options);
  if (!unchanging) {
    return undefined;
  }
  const scope = scopeAt(context.scopes, context.parents, site);
  return lookup(scope, value.name) === binding ? value.name : undefined;
}

/**
 * Whether an attribute is an event handler given as a function. The
 * function runs with no owner, so a `useContext` in it throws whether or
 * not a provider is above it.
 */
function isHandlerFunction(attribute: JSXAttribute): boolean {
  const { name, value } = attribute;
  const text =
    name.type === 'JSXIdentifier' ? name.name : `${name.namespace.name}:${name.name.name}`;
  if (!/^on(?:[A-Z]|:)/.test(text) || value?.type !== 'JSXExpressionContainer') {
    return false;
  }
  const expression = value.expression.type === 'JSXEmptyExpression' ? undefined : value.expression;
  return expression !== undefined && isFunctionNode(unwrap(expression));
}

/**
 * Whether a binding is a signal or store getter or setter, or a memo, which
 * run no code of the app when called.
 */
function isAccessor(context: PassContext, binding: Binding): boolean {
  if (binding.mutated) {
    return false;
  }
  const { declaration } = binding;
  if (declaration.type !== 'VariableDeclarator') {
    return false;
  }
  const { id, init } = declaration;
  const call = init ? unwrap(init) : undefined;
  if (call?.type !== 'CallExpression') {
    return false;
  }
  const callee = solidCallee(context, call);
  if (id === binding.identifier) {
    return callee === 'createMemo';
  }
  if (id.type !== 'ArrayPattern' || callee === undefined || !ACCESSOR_PAIRS.has(callee)) {
    return false;
  }
  const index = id.elements.findIndex((element) => element === binding.identifier);
  return index === 0 || index === 1;
}

export interface ClosedOptions {
  /** Whether a component element can be treated as visible code. */
  readonly component: (element: JSXElement) => boolean;
  /** A component's own props, whose reads are replaced when it is inlined. */
  readonly props?: Binding;
  /** The value a read of a context gets, when the provider is known. */
  readonly contextValue?: (target: Binding) => Expression | undefined;
}

/**
 * Whether all code that can run under `root` is visible, so a provider
 * above it has no reader that is not in it.
 *
 * Calls are limited to Solid's primitives, signal and memo accessors, and
 * methods of known object literals. A use of another component's props
 * runs code of its parent, so it counts as a call. A component's own props
 * are replaced when it is inlined.
 */
export function isClosed(context: PassContext, root: Node, options: ClosedOptions): boolean {
  let closed = true;
  const visit = (node: Node): void => {
    if (!closed) {
      return;
    }
    switch (node.type) {
      case 'JSXAttribute':
        if (isHandlerFunction(node)) {
          return;
        }
        break;
      case 'JSXSpreadAttribute':
        // A view of the component's own props is expanded when it inlines.
        if (!isOwnView(context, node.argument, options.props, 0)) {
          closed = false;
          return;
        }
        break;
      case 'JSXSpreadChild':
      case 'NewExpression':
      case 'TaggedTemplateExpression':
      case 'ImportExpression':
        closed = false;
        return;
      case 'JSXElement':
        if (!isVisibleElement(context, node, options)) {
          closed = false;
          return;
        }
        break;
      case 'CallExpression':
        if (!isVisibleCall(context, node, options)) {
          closed = false;
          return;
        }
        break;
      case 'Identifier': {
        // Another component's props run its parent's code when read, and
        // passing them on, as to `merge()`, reads them somewhere else. A
        // parameter declared under `root`, like a callback's, is a value.
        const binding = context.scopes.references.get(node);
        if (
          binding?.kind === 'param' &&
          binding !== options.props &&
          (binding.identifier.start < root.start || binding.identifier.end > root.end)
        ) {
          closed = false;
          return;
        }
        break;
      }
      default:
        break;
    }
    forEachChild(node, visit);
  };
  visit(root);
  return closed;
}

/**
 * Whether an expression is a `merge()` or `omit()` view of a component's
 * own props, with only literal objects and keys besides.
 */
function isOwnView(
  context: PassContext,
  node: Expression,
  props: Binding | undefined,
  depth: number,
): boolean {
  const expression = unwrap(node);
  if (props === undefined || depth > 4) {
    return false;
  }
  let call: Node | undefined = expression;
  if (expression.type === 'Identifier') {
    const binding = context.scopes.references.get(expression);
    if (binding === props) {
      return true;
    }
    const init = binding ? constantInit(context, binding) : undefined;
    call = init ? unwrap(init) : undefined;
  }
  if (call?.type !== 'CallExpression') {
    return false;
  }
  const callee = solidCallee(context, call);
  if (callee !== 'merge' && callee !== 'omit') {
    return false;
  }
  return call.arguments.every((argument) => {
    if (argument.type === 'SpreadElement') {
      return false;
    }
    const inner = unwrap(argument);
    return (
      inner.type === 'ObjectExpression' ||
      (inner.type === 'Literal' && typeof inner.value === 'string') ||
      isOwnView(context, inner, props, depth + 1)
    );
  });
}

function isVisibleElement(
  context: PassContext,
  element: JSXElement,
  options: ClosedOptions,
): boolean {
  const { name } = element.openingElement;
  if (name.type !== 'JSXIdentifier') {
    return false;
  }
  if (isIntrinsicTag(name.name)) {
    return true;
  }
  if (contextBinding(context, name)) {
    return true;
  }
  const binding = context.scopes.references.get(name);
  const identity = binding ? solidExport(binding, context.options) : name.name;
  // `<Dynamic>` renders a component it is given, which is not visible.
  if (identity !== undefined && identity !== 'Dynamic' && context.options.builtIns.has(identity)) {
    return true;
  }
  return options.component(element);
}

function isVisibleCall(
  context: PassContext,
  call: CallExpression,
  options: ClosedOptions,
): boolean {
  const callee = unwrap(call.callee);
  if (callee.type === 'MemberExpression') {
    return isVisibleMethod(context, callee, options);
  }
  if (callee.type !== 'Identifier') {
    return false;
  }
  const binding = context.scopes.references.get(callee);
  if (!binding) {
    return false;
  }
  const identity = solidExport(binding, context.options);
  if (identity !== undefined) {
    return CONTEXT_SAFE_PRIMITIVES.includes(identity);
  }
  return isAccessorValue(context, callee, options, 0);
}

/**
 * Whether an expression evaluates to a signal, store, or memo accessor,
 * through bindings that never change and reads of a context whose value is
 * known.
 */
function isAccessorValue(
  context: PassContext,
  node: Expression,
  options: ClosedOptions,
  depth: number,
): boolean {
  const expression = unwrap(node);
  if (depth > 4) {
    return false;
  }
  if (expression.type === 'CallExpression') {
    const value = contextValueOf(context, expression, options);
    return value !== undefined && isAccessorValue(context, value, options, depth + 1);
  }
  if (expression.type !== 'Identifier') {
    return false;
  }
  const binding = context.scopes.references.get(expression);
  if (!binding) {
    return false;
  }
  if (isAccessor(context, binding)) {
    return true;
  }
  const init = constantInit(context, binding);
  return init !== undefined && isAccessorValue(context, init, options, depth + 1);
}

/**
 * The initializer of a binding that never changes, declared on its own.
 */
function constantInit(context: PassContext, binding: Binding): Expression | undefined {
  const { declaration } = binding;
  if (
    !isConstantDeclaration(binding, context.options) ||
    declaration.type !== 'VariableDeclarator' ||
    declaration.id !== binding.identifier ||
    !declaration.init
  ) {
    return undefined;
  }
  return declaration.init;
}

/**
 * The value `useContext(Ctx)` returns, when the provider is known.
 */
function contextValueOf(
  context: PassContext,
  call: CallExpression,
  options: ClosedOptions,
): Expression | undefined {
  const argument = call.arguments.at(0);
  if (
    solidCallee(context, call) !== 'useContext' ||
    call.arguments.length !== 1 ||
    argument === undefined ||
    argument.type === 'SpreadElement'
  ) {
    return undefined;
  }
  const target = contextBinding(context, unwrap(argument));
  return target ? options.contextValue?.(target) : undefined;
}

/**
 * Whether calling `object.name()` runs only visible code: the object is an
 * object literal, directly or through bindings that never change or a
 * context read, and the property is an accessor or a visible function.
 */
function isVisibleMethod(
  context: PassContext,
  member: MemberExpression,
  options: ClosedOptions,
): boolean {
  if (member.computed || member.property.type !== 'Identifier' || member.optional) {
    return false;
  }
  const object = objectLiteralOf(context, member.object, options, 0);
  if (!object || object.properties.some((property) => property.type !== 'Property')) {
    return false;
  }
  const { name } = member.property;
  const matches = object.properties.filter(
    (property) =>
      property.type === 'Property' &&
      !property.computed &&
      property.key.type === 'Identifier' &&
      property.key.name === name,
  );
  const property = matches.at(0);
  if (matches.length !== 1 || property?.type !== 'Property' || property.kind !== 'init') {
    return false;
  }
  const value = unwrap(property.value);
  if (isFunctionNode(value)) {
    return isClosed(context, value, options);
  }
  if (value.type !== 'Identifier') {
    return false;
  }
  const binding = context.scopes.references.get(value);
  if (!binding) {
    return false;
  }
  const identity = solidExport(binding, context.options);
  return identity === undefined
    ? isAccessorValue(context, value, options, 0)
    : CONTEXT_SAFE_PRIMITIVES.includes(identity);
}

/**
 * The object literal an expression evaluates to, through bindings that
 * never change and reads of a context whose value is known.
 */
function objectLiteralOf(
  context: PassContext,
  node: Expression,
  options: ClosedOptions,
  depth: number,
): ObjectExpression | undefined {
  const expression = unwrap(node);
  if (depth > 4) {
    return undefined;
  }
  if (expression.type === 'ObjectExpression') {
    return expression;
  }
  if (expression.type === 'CallExpression') {
    const value = contextValueOf(context, expression, options);
    return value ? objectLiteralOf(context, value, options, depth + 1) : undefined;
  }
  if (expression.type !== 'Identifier') {
    return undefined;
  }
  const binding = context.scopes.references.get(expression);
  const init = binding ? constantInit(context, binding) : undefined;
  return init ? objectLiteralOf(context, init, options, depth + 1) : undefined;
}

/**
 * The `useContext(Ctx)` calls under `root` that run under its owner, so
 * not in an event handler, and that no other provider of `Ctx` under
 * `root` answers.
 */
export function contextReads(context: PassContext, root: Node, target: Binding): CallExpression[] {
  const reads: CallExpression[] = [];
  const visit = (node: Node): void => {
    if (node.type === 'JSXAttribute' && isHandlerFunction(node)) {
      return;
    }
    // A read under another provider of the same context belongs to that one.
    if (
      node !== root &&
      node.type === 'JSXElement' &&
      contextBinding(context, node.openingElement.name) === target
    ) {
      return;
    }
    if (node.type === 'CallExpression' && solidCallee(context, node) === 'useContext') {
      const argument = node.arguments.at(0);
      if (
        node.arguments.length === 1 &&
        argument?.type !== 'SpreadElement' &&
        argument !== undefined &&
        contextBinding(context, unwrap(argument)) === target
      ) {
        reads.push(node);
      }
    }
    forEachChild(node, visit);
  };
  visit(root);
  return reads;
}

/**
 * Whether a provider of the same context sits under `element`. A read under
 * it belongs to it, so the inner one is rewritten first.
 */
export function hasNestedProvider(context: PassContext, provider: Provider): boolean {
  let nested = false;
  const visit = (node: Node): void => {
    if (nested) {
      return;
    }
    if (
      node !== provider.element &&
      node.type === 'JSXElement' &&
      contextBinding(context, node.openingElement.name) === provider.context
    ) {
      nested = true;
      return;
    }
    forEachChild(node, visit);
  };
  for (const child of provider.element.children) {
    visit(child);
  }
  return nested;
}

/**
 * Every provider in the program, outermost first.
 */
export function findProviders(context: PassContext): Provider[] {
  const providers: Provider[] = [];
  const visit = (node: Node): void => {
    if (node.type === 'JSXElement') {
      const provider = providerOf(context, node);
      if (provider) {
        providers.push(provider);
      }
    }
    forEachChild(node, visit);
  };
  visit(context.program);
  return providers;
}

class ProviderRemover {
  changed = false;

  constructor(private readonly context: PassContext) {}

  private readonly removed: JSXElement[] = [];

  run(): void {
    for (const provider of findProviders(this.context)) {
      // A provider inside one removed in this pass waits for the next pass,
      // so their edits do not overlap.
      const { element } = provider;
      const overlaps = this.removed.some(
        (other) => element.start < other.end && other.start < element.end,
      );
      if (!overlaps && !hasNestedProvider(this.context, provider) && this.tryRemove(provider)) {
        this.removed.push(element);
      }
    }
  }

  private tryRemove(provider: Provider): boolean {
    const { element } = provider;
    const children = element.children;
    const closed = children.every((child) =>
      isClosed(this.context, child, {
        component: () => false,
        contextValue: (target) => (target === provider.context ? provider.value : undefined),
      }),
    );
    if (!closed) {
      return false;
    }
    const reads = children.flatMap((child) => contextReads(this.context, child, provider.context));
    const texts: string[] = [];
    for (const read of reads) {
      const text = stableValueText(this.context, provider, read);
      if (text === undefined) {
        return false;
      }
      texts.push(text);
    }
    // With no reads, the value is only dropped when evaluating it does nothing.
    if (reads.length === 0 && !isSideEffectFree(provider.value)) {
      const stable = stableValueText(this.context, provider, element);
      if (stable === undefined) {
        return false;
      }
    }
    const { s } = this.context;
    for (const [index, read] of reads.entries()) {
      s.overwrite(read.start, read.end, texts[index] ?? '');
    }
    const { openingElement, closingElement } = element;
    s.overwrite(openingElement.start, openingElement.end, '<>');
    if (closingElement) {
      s.overwrite(closingElement.start, closingElement.end, '</>');
    }
    this.changed = true;
    return true;
  }
}

/**
 * Runs the provider pass over a parsed program. Returns whether anything changed.
 */
export function removeProviders(context: PassContext): boolean {
  const remover = new ProviderRemover(context);
  remover.run();
  return remover.changed;
}
