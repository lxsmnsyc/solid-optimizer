/**
 * `<Show>` lowering.
 *
 * Solid's JSX transform compiles `{when ? children : fallback}` to a memo of
 * `!!when` and a function that renders the branch it selects, which is what
 * `<Show>` does without a callback child or `keyed`. The ternary skips the
 * component call, the props object with its getters, and two of `<Show>`'s
 * three memos.
 */
import type { JSXAttribute, JSXChild, JSXElement, Node } from 'oxc-parser';
import { forEachChild, isFunctionNode, isInsignificant, isIntrinsicTag } from './ast';
import type { PassContext } from './context';
import { solidExport } from './context';
import { findAttribute, hasCallbackChild } from './jsx';

/**
 * How a lowered `<Show>` is written where it stands.
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
 * Rewrites each `<Show>` that can be lowered. A `<Show>` inside one that is
 * lowered stays for the next run, since both would edit the same text.
 */
export function lowerShows(context: PassContext): boolean {
  let changed = false;
  visit(context.program);
  return changed;

  function visit(node: Node): void {
    if (node.type === 'JSXElement' && isShow(context, node)) {
      const form = formAt(context, node);
      const text = form === undefined ? undefined : lowered(context, node, form);
      if (text !== undefined) {
        context.s.overwrite(node.start, node.end, text);
        changed = true;
        return;
      }
    }
    forEachChild(node, visit);
  }
}

/**
 * Whether an element is Solid's own `<Show>`, by the name its tag resolves to.
 */
function isShow(context: PassContext, element: JSXElement): boolean {
  const { name } = element.openingElement;
  if (name.type !== 'JSXIdentifier') {
    return false;
  }
  const { references } = context.scopes;
  if (!references.has(name)) {
    return false;
  }
  const binding = references.get(name);
  const identity = binding ? solidExport(binding, context.options) : name.name;
  return identity === 'Show' && context.options.builtIns.has('Show');
}

/**
 * How a `<Show>` at this position is written once lowered, or `undefined`
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
      if (name.type === 'JSXIdentifier' && isIntrinsicTag(name.name)) {
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
 * The text of a lowered `<Show>`, or `undefined` when its props or children
 * need the component.
 */
function lowered(context: PassContext, element: JSXElement, form: Form): string | undefined {
  // Only `when` and `fallback` are supported. `keyed` and spreads change what the children get.
  for (const attribute of element.openingElement.attributes) {
    if (
      attribute.type !== 'JSXAttribute' ||
      attribute.name.type !== 'JSXIdentifier' ||
      (attribute.name.name !== 'when' && attribute.name.name !== 'fallback')
    ) {
      return undefined;
    }
  }
  // A callback child receives the narrowed value, which a ternary has no way to pass.
  if (hasCallbackChild(element.children)) {
    return undefined;
  }

  const when = expressionText(context, findAttribute(element, 'when'));
  const fallback = expressionText(context, findAttribute(element, 'fallback'));
  if (when === undefined || when === null || fallback === undefined) {
    return undefined;
  }

  // The children become one fragment, which keeps JSX's own whitespace rules for them.
  const { closingElement } = element;
  const inner = closingElement
    ? context.s.slice(element.openingElement.end, closingElement.start)
    : '';
  const children = hasContent(element.children) ? `<>${inner}</>` : 'undefined';

  const ternary = `${when} ? ${children} : ${fallback ?? 'undefined'}`;
  return form === 'container' ? `{${ternary}}` : `<>{${ternary}}</>`;
}

function hasContent(children: readonly JSXChild[]): boolean {
  for (const child of children) {
    if (!isInsignificant(child)) {
      return true;
    }
  }
  return false;
}

/**
 * The text of an attribute's value as an expression: `null` when the
 * attribute is missing, `undefined` when its value is not supported.
 */
function expressionText(
  context: PassContext,
  attribute: JSXAttribute | undefined,
): string | null | undefined {
  if (attribute === undefined) {
    return null;
  }
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
      return `(${context.s.slice(value.expression.start, value.expression.end)})`;
    case 'JSXElement':
    case 'JSXFragment':
      return context.s.slice(value.start, value.end);
    default:
      // A string literal can hold HTML entities, which a JS string does not decode.
      return undefined;
  }
}
