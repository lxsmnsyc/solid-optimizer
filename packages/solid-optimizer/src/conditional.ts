/**
 * `<Show>` and `<Switch>` lowering.
 *
 * Solid's JSX transform compiles `{when ? children : fallback}` to a memo of
 * `!!when` and a function that renders the branch it selects, which is what
 * `<Show>` does without a callback child or `keyed`. The ternary skips the
 * component call, the props object with its getters, and two of `<Show>`'s
 * three memos.
 *
 * A `<Switch>` becomes a chain, `a ? A : b ? B : fallback`. The transform
 * gives each later condition its own memo, read only when the ones before it
 * are falsy, as `<Switch>` reads its `<Match>` conditions.
 *
 * A callback child like `{(user) => <b>{user().name}</b>}` becomes its body,
 * with each `user()` read as `when` again. Only a `when` that reads names,
 * members, and signals or memos is copied, so reading it again gives the same
 * value. `<Show>`'s
 * accessor throws when it is read after the condition turns falsy, and the
 * copy reads the falsy value instead.
 */
import type { ArrowFunctionExpression, JSXAttribute, JSXChild, JSXElement, Node } from 'oxc-parser';
import { forEachChild, isFunctionNode, isInsignificant, isIntrinsicTag, unwrap } from './ast';
import type { PassContext } from './context';
import { solidExport } from './context';
import { findAttribute } from './jsx';
import { lookup, scopeAt } from './scope';
import type { Content, Text } from './text';
import { join, joinText } from './text';

/**
 * How a lowered `<Show>` or `<Switch>` is written where it stands.
 *
 * - `container`: `{when ? children : fallback}`. A child of an element is
 *   inserted, and a child of a fragment becomes a memo, so both track the
 *   ternary.
 * - `fragment`: `<>{when ? children : fallback}</>`, which compiles to a memo.
 *   A ternary alone as a component's child would be read again on every read
 *   of `props.children`, without a memo around it.
 */
type Form = 'container' | 'fragment';

/**
 * Rewrites each `<Show>` and `<Switch>` that can be lowered. One inside
 * another that is lowered stays for the next run, since both would edit the
 * same text.
 */
export function lowerConditionals(context: PassContext): boolean {
  let changed = false;
  visit(context.program);
  return changed;

  function visit(node: Node): void {
    if (node.type === 'JSXElement') {
      const ternary = ternaryOf(context, node);
      const form = ternary === undefined ? undefined : formAt(context, node);
      if (ternary !== undefined && form !== undefined) {
        context.s.overwrite(
          node.start,
          node.end,
          form === 'container' ? joinText`{${ternary}}` : joinText`<>{${ternary}}</>`,
        );
        changed = true;
        return;
      }
    }
    forEachChild(node, visit);
  }
}

/**
 * The Solid built-in an element's tag resolves to, by the name Solid exports it under.
 */
function builtInOf(context: PassContext, element: JSXElement): string | undefined {
  const { name } = element.openingElement;
  if (name.type !== 'JSXIdentifier') {
    return undefined;
  }
  const { references } = context.scopes;
  if (!references.has(name)) {
    return undefined;
  }
  const binding = references.get(name);
  const identity = binding ? solidExport(binding, context.options) : name.name;
  return identity !== undefined && context.options.builtIns.has(identity) ? identity : undefined;
}

/**
 * The ternary a `<Show>` or `<Switch>` lowers to, or `undefined` when its
 * props or children need the component.
 */
function ternaryOf(context: PassContext, element: JSXElement): Text | undefined {
  switch (builtInOf(context, element)) {
    case 'Show': {
      const branch = branchOf(context, element, ['when', 'fallback']);
      if (branch === undefined) {
        return undefined;
      }
      return joinText`${branch.when} ? ${branch.children} : ${branch.fallback ?? 'undefined'}`;
    }
    case 'Switch':
      return switchTernary(context, element);
    default:
      return undefined;
  }
}

/**
 * A `<Switch>` whose children are all `<Match>`es that lower, as a chain of ternaries.
 */
function switchTernary(context: PassContext, element: JSXElement): Text | undefined {
  const props = propsOf(context, element, ['fallback']);
  if (props === undefined) {
    return undefined;
  }
  const chain: Content[] = [];
  let count = 0;
  for (const child of significantChildren(element.children)) {
    if (child.type !== 'JSXElement' || builtInOf(context, child) !== 'Match') {
      return undefined;
    }
    const branch = branchOf(context, child, ['when']);
    if (branch === undefined) {
      return undefined;
    }
    chain.push(branch.when, ' ? ', branch.children, ' : ');
    count += 1;
  }
  // A `<Switch>` without a `<Match>` renders its fallback, which the fold pass resolves.
  if (count === 0) {
    return undefined;
  }
  return join([...chain, props.get('fallback') ?? 'undefined']);
}

/**
 * How a `<Show>` or `<Switch>` at this position is written once lowered, or `undefined`
 * when the position is not supported.
 */
function formAt(context: PassContext, element: JSXElement): Form | undefined {
  const parent = context.parents.get(element);
  if (parent === undefined) {
    return 'fragment';
  }
  switch (parent.type) {
    case 'JSXFragment':
      return 'container';
    case 'JSXElement': {
      const { name } = parent.openingElement;
      // A namespaced tag like `svg:g` is an element too.
      if (
        name.type === 'JSXNamespacedName' ||
        (name.type === 'JSXIdentifier' && isIntrinsicTag(name.name))
      ) {
        return 'container';
      }
      // A component's children are one prop. Only a sole child keeps that prop a memo.
      return isSoleChild(parent.children, element) ? 'fragment' : undefined;
    }
    case 'JSXExpressionContainer':
    case 'JSXAttribute':
      return undefined;
    default:
      // An expression outside JSX, such as a return value or a callback's body.
      return isInJSXExpression(context, parent) ? undefined : 'fragment';
  }
}

/**
 * Whether a node is part of an expression in a JSX container, such as
 * `{ok && <Show />}`, where a function boundary does not separate them.
 */
function isInJSXExpression(context: PassContext, node: Node): boolean {
  let current: Node | undefined = node;
  while (current !== undefined && !isFunctionNode(current)) {
    if (current.type === 'JSXExpressionContainer') {
      return true;
    }
    current = context.parents.get(current);
  }
  return false;
}

function isSoleChild(children: readonly JSXChild[], element: JSXElement): boolean {
  for (const child of children) {
    if (child !== element && !isInsignificant(child)) {
      return false;
    }
  }
  return true;
}

/**
 * The text of each prop of an element, or `undefined` when it has a prop
 * other than `names`, a spread, or a prop more than once. A repeated prop
 * takes its last value, and a spread could hold any prop, such as `keyed`.
 */
function propsOf(
  context: PassContext,
  element: JSXElement,
  names: readonly string[],
): Map<string, Text> | undefined {
  const props = new Map<string, Text>();
  for (const attribute of element.openingElement.attributes) {
    if (
      attribute.type !== 'JSXAttribute' ||
      attribute.name.type !== 'JSXIdentifier' ||
      !names.includes(attribute.name.name) ||
      props.has(attribute.name.name)
    ) {
      return undefined;
    }
    const text = expressionText(context, attribute);
    if (text === undefined) {
      return undefined;
    }
    props.set(attribute.name.name, text);
  }
  return props;
}

interface Branch {
  readonly when: Text;
  readonly children: Content;
  readonly fallback: Text | undefined;
}

/**
 * The condition and children of a `<Show>` or `<Match>`, or `undefined` when
 * the children could need the narrowed value.
 */
function branchOf(
  context: PassContext,
  element: JSXElement,
  names: readonly string[],
): Branch | undefined {
  const props = propsOf(context, element, names);
  const when = props?.get('when');
  if (props === undefined || when === undefined) {
    return undefined;
  }
  const significant = significantChildren(element.children);
  const sole = significant.length === 1 ? significant[0] : undefined;

  // A callback child becomes its body, with the narrowed value read as `when`.
  const callback =
    sole?.type === 'JSXExpressionContainer' && sole.expression.type !== 'JSXEmptyExpression'
      ? unwrap(sole.expression)
      : undefined;
  if (callback?.type === 'ArrowFunctionExpression') {
    const body = callbackBody(context, element, callback);
    return body === undefined
      ? undefined
      : { when, children: body, fallback: props.get('fallback') };
  }

  // Any other function child also receives the narrowed value. A sole child
  // that could hold a function, like `{render}`, counts too. Several
  // children are an array, which is rendered as it is.
  if (
    sole?.type === 'JSXExpressionContainer' &&
    sole.expression.type !== 'JSXEmptyExpression' &&
    !isNeverFunction(sole.expression)
  ) {
    return undefined;
  }
  for (const child of significant) {
    if (
      child.type === 'JSXExpressionContainer' &&
      child.expression.type !== 'JSXEmptyExpression' &&
      isFunctionNode(unwrap(child.expression))
    ) {
      return undefined;
    }
  }

  // The children become one fragment, which keeps JSX's own whitespace rules for them.
  const { closingElement } = element;
  const inner = closingElement
    ? context.s.slice(element.openingElement.end, closingElement.start)
    : '';
  return {
    when,
    children: significant.length > 0 ? joinText`<>${inner}</>` : 'undefined',
    fallback: props.get('fallback'),
  };
}

/**
 * The body of a callback child with each read of its parameter written as
 * `when`, or `undefined` when that could change what the body renders.
 */
function callbackBody(
  context: PassContext,
  element: JSXElement,
  callback: ArrowFunctionExpression,
): Text | undefined {
  // `<Show>` only passes the value to a callback that takes a parameter, and
  // calls it untracked. A body that is only JSX reads nothing as it is made.
  const param = callback.params.at(0);
  if (
    callback.async ||
    callback.body.type === 'BlockStatement' ||
    callback.params.length !== 1 ||
    param?.type !== 'Identifier'
  ) {
    return undefined;
  }
  const body = unwrap(callback.body);
  if (body.type !== 'JSXElement' && body.type !== 'JSXFragment') {
    return undefined;
  }
  const attribute = findAttribute(element, 'when');
  const value = attribute?.value;
  if (
    value?.type !== 'JSXExpressionContainer' ||
    value.expression.type === 'JSXEmptyExpression' ||
    !isPlainRead(context, value.expression)
  ) {
    return undefined;
  }
  const when = value.expression;
  const whenText = joinText`(${context.s.slice(when.start, when.end)})`;

  // Each name `when` reads has to mean the same thing where the body reads the parameter.
  const names: Node[] = [];
  collectReferences(context, when, names);
  const binding = lookup(scopeAt(context.scopes, context.parents, param), param.name);
  // A write to the parameter, or a type that names it, has no copy to point at.
  if (binding?.identifier !== param || binding.mutated || namesInTypes(body, param.name)) {
    return undefined;
  }
  const edits: { start: number; end: number; text: Text }[] = [];
  for (const reference of binding.references) {
    // A tag like `<C />` names a component, which an expression cannot replace.
    if (reference.type !== 'Identifier') {
      return undefined;
    }
    const scope = scopeAt(context.scopes, context.parents, reference);
    for (const name of names) {
      if (
        name.type !== 'Identifier' ||
        lookup(scope, name.name) !== context.scopes.references.get(name)
      ) {
        return undefined;
      }
    }
    const parent = context.parents.get(reference);
    if (
      parent?.type === 'CallExpression' &&
      parent.callee === reference &&
      parent.arguments.length === 0 &&
      !parent.optional
    ) {
      edits.push({ start: parent.start, end: parent.end, text: whenText });
    } else if (parent?.type === 'Property' && parent.shorthand) {
      return undefined;
    } else {
      edits.push({
        start: reference.start,
        end: reference.end,
        text: joinText`(() => ${whenText})`,
      });
    }
  }

  // Write the body with the edits, in order.
  edits.sort((a, b) => a.start - b.start);
  const parts: Text[] = [];
  let at = body.start;
  for (const edit of edits) {
    parts.push(context.s.slice(at, edit.start), edit.text);
    at = edit.end;
  }
  parts.push(context.s.slice(at, body.end));
  return join(parts);
}

/**
 * Whether reading an expression again gives the same value, with nothing run
 * between the reads: names, members, literals, and operators, and calls of
 * a signal or a memo. Another call could change something or return
 * something new, and `this` changes inside a `function` in the body.
 */
function isPlainRead(context: PassContext, node: Node): boolean {
  switch (node.type) {
    case 'Identifier':
    case 'Literal':
      return true;
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'ChainExpression':
      return isPlainRead(context, node.expression);
    case 'MemberExpression':
      return (
        isPlainRead(context, node.object) && (!node.computed || isPlainRead(context, node.property))
      );
    case 'CallExpression':
      return node.arguments.length === 0 && isAccessor(context, node.callee);
    case 'UnaryExpression':
      return node.operator !== 'delete' && isPlainRead(context, node.argument);
    case 'BinaryExpression':
    case 'LogicalExpression':
      return isPlainRead(context, node.left) && isPlainRead(context, node.right);
    case 'ConditionalExpression':
      return (
        isPlainRead(context, node.test) &&
        isPlainRead(context, node.consequent) &&
        isPlainRead(context, node.alternate)
      );
    default:
      return false;
  }
}

/**
 * Whether a callee is the getter of a `createSignal` or a `createMemo` from
 * Solid, declared with `const` and never written, which returns its current
 * value without running anything else.
 */
function isAccessor(context: PassContext, callee: Node): boolean {
  if (callee.type !== 'Identifier') {
    return false;
  }
  const binding = context.scopes.references.get(callee);
  if (!binding || binding.mutated || binding.kind !== 'const') {
    return false;
  }
  const { declaration } = binding;
  if (declaration.type !== 'VariableDeclarator' || !declaration.init) {
    return false;
  }
  const init = unwrap(declaration.init);
  if (init.type !== 'CallExpression' || init.callee.type !== 'Identifier') {
    return false;
  }
  const factory = context.scopes.references.get(init.callee);
  const name = factory ? solidExport(factory, context.options) : undefined;
  if (name === 'createMemo') {
    return declaration.id === binding.identifier;
  }
  // The getter is the first name of `const [value, setValue] = createSignal()`.
  return (
    name === 'createSignal' &&
    declaration.id.type === 'ArrayPattern' &&
    declaration.id.elements.at(0) === binding.identifier
  );
}

/** Whether a TypeScript type in `node`, like `typeof v`, names `name`. */
function namesInTypes(node: unknown, name: string): boolean {
  if (typeof node !== 'object' || node === null) {
    return false;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      if (namesInTypes(item, name)) {
        return true;
      }
    }
    return false;
  }
  const type: unknown = Reflect.get(node, 'type');
  if (type === 'TSTypeQuery') {
    const exprName: unknown = Reflect.get(node, 'exprName');
    return (
      typeof exprName === 'object' && exprName !== null && Reflect.get(exprName, 'name') === name
    );
  }
  for (const key of Object.keys(node)) {
    if (key !== 'parent' && namesInTypes(Reflect.get(node, key), name)) {
      return true;
    }
  }
  return false;
}

/** The identifiers in an expression that refer to a binding or a global. */
function collectReferences(context: PassContext, node: Node, out: Node[]): void {
  if (node.type === 'Identifier' && context.scopes.references.has(node)) {
    out.push(node);
  }
  forEachChild(node, (child) => {
    collectReferences(context, child, out);
  });
}

/**
 * Whether an expression's value can never be a function: a literal, JSX, or
 * an operator that returns a string, number, or boolean.
 */
function isNeverFunction(node: Node): boolean {
  switch (node.type) {
    case 'Literal':
    case 'TemplateLiteral':
    case 'JSXElement':
    case 'JSXFragment':
    case 'BinaryExpression':
    case 'UnaryExpression':
    case 'UpdateExpression':
      return true;
    case 'ParenthesizedExpression':
      return isNeverFunction(node.expression);
    case 'ConditionalExpression':
      return isNeverFunction(node.consequent) && isNeverFunction(node.alternate);
    case 'LogicalExpression':
      return isNeverFunction(node.left) && isNeverFunction(node.right);
    default:
      return false;
  }
}

function significantChildren(children: readonly JSXChild[]): JSXChild[] {
  const result: JSXChild[] = [];
  for (const child of children) {
    if (!isInsignificant(child)) {
      result.push(child);
    }
  }
  return result;
}

/**
 * The text of an attribute's value as an expression, or `undefined` when the
 * value is not supported.
 */
function expressionText(context: PassContext, attribute: JSXAttribute): Text | undefined {
  const { value } = attribute;
  if (value === null) {
    // A bare attribute is `true`. The fold pass resolves those.
    return undefined;
  }
  switch (value.type) {
    case 'JSXExpressionContainer':
      if (value.expression.type === 'JSXEmptyExpression') {
        return undefined;
      }
      return joinText`(${context.s.slice(value.expression.start, value.expression.end)})`;
    case 'JSXElement':
    case 'JSXFragment':
      return context.s.slice(value.start, value.end);
    default:
      // A string literal can hold HTML entities, which a JS string does not decode.
      return undefined;
  }
}
