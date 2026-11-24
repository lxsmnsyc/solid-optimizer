/**
 * Tidies the JSX the other passes wrote, without changing what it renders.
 *
 * - An empty `{}` child goes. The passes write one to keep two texts apart,
 *   so it only goes when the texts on both sides read the same without it.
 * - A string in braces becomes plain JSX: `class={'card'}` becomes
 *   `class="card"`, and a `{'Hello'}` child becomes the text `Hello`.
 * - A fragment that holds one element, with only line breaks around it,
 *   becomes that element.
 *
 * Each edit follows a model of how Solid's JSX transform reads JSX: its
 * whitespace rule, which strings it writes as they are, and where a fragment
 * around one element lowers the same as the element. Anything outside the
 * model, such as unusual whitespace, stays as it is. The tests lower the
 * tidied and untidied output and expect the same code.
 */
import type {
  JSXAttribute,
  JSXElement,
  JSXExpressionContainer,
  JSXFragment,
  Node,
} from 'oxc-parser';
import { forEachChild } from './ast';
import type { PassContext } from './context';

type Child = JSXElement['children'][number];

/**
 * The text Solid's JSX transform makes of a raw text child: when the text
 * has a line break, each line after the first loses its leading spaces, lines
 * of only spaces drop out and the rest join with a space; then every run of
 * spaces becomes one space. This differs from React's rule, which keeps runs
 * of spaces on one line.
 */
export function cleanText(raw: string): string {
  let text = raw.replaceAll('\r', '');
  if (text.includes('\n')) {
    const kept: string[] = [];
    for (const [index, line] of text.split('\n').entries()) {
      const trimmed = index === 0 ? line : line.replace(/^[ \t]+/, '');
      if (/[^ \t]/.test(trimmed)) {
        kept.push(trimmed);
      }
    }
    text = kept.join(' ');
  }
  return text.replaceAll(/[ \t\n]+/g, ' ');
}

/**
 * Whether a text holds whitespace or format characters other than space,
 * tab and line breaks, such as U+0085 or a byte order mark. Solid's JSX
 * transform and JavaScript disagree on some of them, so such text stays as it is.
 */
function hasUnusualSpace(text: string): boolean {
  return /(?![ \t\n\r])[\s\p{White_Space}\p{Cf}]/u.test(text);
}

/**
 * The string a container holds when it is a plain string written without
 * escapes, such as `{'a'}` or `{`a`}`. The characters between the quotes are
 * then the string itself, so tidying keeps them, and their source map
 * positions, and only drops what is around them.
 */
function readString(container: JSXExpressionContainer, code: string): string | undefined {
  const { expression } = container;
  let value: string | undefined;
  if (expression.type === 'Literal' && typeof expression.value === 'string') {
    value = expression.value;
  } else if (
    expression.type === 'TemplateLiteral' &&
    expression.expressions.length === 0 &&
    expression.quasis.length === 1
  ) {
    value = expression.quasis[0].value.cooked ?? undefined;
  }
  if (value === undefined || code.slice(expression.start + 1, expression.end - 1) !== value) {
    return undefined;
  }
  // Braces that hold a comment beside the string keep it.
  const around =
    code.slice(container.start + 1, expression.start) +
    code.slice(expression.end, container.end - 1);
  if (around.trim() !== '') {
    return undefined;
  }
  return value;
}

/**
 * Replaces the braces and quotes around a string with `before` and `after`,
 * keeping the string's own characters where they are.
 */
function unwrapString(
  container: JSXExpressionContainer,
  before: string,
  after: string,
  context: PassContext,
): void {
  const { expression } = container;
  const { code, s } = context;
  // Removing keeps the mapping of the string's characters, and of quotes
  // that stay. Only a quote that changes is written.
  s.remove(container.start, expression.start);
  s.remove(expression.end, container.end);
  const open = code[expression.start];
  const close = code[expression.end - 1];
  if (before === open) {
    // The quote stays.
  } else if (before === '') {
    s.remove(expression.start, expression.start + 1);
  } else {
    s.overwrite(expression.start, expression.start + 1, s.written(before, expression.start));
  }
  if (after === close) {
    // The quote stays.
  } else if (after === '') {
    s.remove(expression.end - 1, expression.end);
  } else {
    s.overwrite(expression.end - 1, expression.end, s.written(after, expression.end - 1));
  }
}

/** Whether a container holds nothing, not even a comment. */
function isEmpty(container: JSXExpressionContainer, code: string): boolean {
  return (
    container.expression.type === 'JSXEmptyExpression' &&
    code.slice(container.start + 1, container.end - 1).trim() === ''
  );
}

/**
 * A child as it renders: raw text, which JSX cleans together with the raw
 * text next to it; a literal string, which renders as it is and keeps the
 * texts on its sides apart; or something else, such as an element.
 */
type Part = { raw: string } | { literal: string } | { other: number };

/**
 * The pieces a list of children renders: each text that is not empty, and a
 * mark for each child that is not text.
 */
function renderPieces(parts: readonly (Part | undefined)[]): string[] {
  const pieces: string[] = [];
  let raw: string | undefined;
  const flush = (): void => {
    if (raw !== undefined) {
      const text = cleanText(raw);
      if (text !== '') {
        pieces.push(text);
      }
      raw = undefined;
    }
  };
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if ('raw' in part) {
      raw = (raw ?? '') + part.raw;
    } else if ('literal' in part) {
      flush();
      if (part.literal !== '') {
        pieces.push(part.literal);
      }
    } else {
      flush();
      pieces.push(`\0${String(part.other)}`);
    }
  }
  flush();
  return pieces;
}

/**
 * What a list of children renders. In an element, Solid's JSX transform
 * writes the texts next to each other into the template as one text, so
 * only the joined text counts. Anywhere else, such as a fragment, each text
 * stays its own string, so the pieces must stay apart too.
 */
function render(parts: readonly (Part | undefined)[], inElement: boolean): string {
  const pieces = renderPieces(parts);
  if (!inElement) {
    return JSON.stringify(pieces);
  }
  let joined = '';
  for (const piece of pieces) {
    joined += piece.startsWith('\0') ? `${piece}\0` : piece;
  }
  return joined;
}

/** Whether an element is an HTML or SVG element, which Solid lowers into a template. */
function isIntrinsic(element: JSXElement): boolean {
  const { name } = element.openingElement;
  if (name.type === 'JSXNamespacedName') {
    return true;
  }
  return name.type === 'JSXIdentifier' && /^[a-z]/.test(name.name);
}

/** A string that can be written as JSX text: no syntax, no entities, no line breaks. */
function isPlainText(value: string): boolean {
  return (
    value !== '' &&
    !/[{}<>&\r\n\t]/.test(value) &&
    !hasUnusualSpace(value) &&
    value.trim() === value
  );
}

/** A string that can be written as a JSX attribute in double quotes. */
function isPlainAttribute(value: string): boolean {
  return !/["&\r\n]/.test(value) && !hasUnusualSpace(value);
}

/**
 * Attributes whose string Solid's JSX transform treats differently once it
 * is written as a plain value: it moves a static `style` last, and `ref`,
 * `classList`, event handlers (`on` in any case) and namespaced attributes do
 * not take a string.
 */
function isTidyAttribute(attribute: JSXAttribute): boolean {
  const { name } = attribute;
  return (
    name.type === 'JSXIdentifier' &&
    name.name !== 'style' &&
    name.name !== 'ref' &&
    name.name !== 'classList' &&
    !name.name.startsWith('on')
  );
}

/**
 * Whether an element can get children from an attribute: a `children`
 * attribute or a spread. Its own children then decide whether those show, so
 * even an empty `{}` among them counts, and they stay as they are.
 */
function hasChildrenAttribute(element: JSXElement): boolean {
  for (const attribute of element.openingElement.attributes) {
    if (
      attribute.type === 'JSXSpreadAttribute' ||
      (attribute.name.type === 'JSXIdentifier' && attribute.name.name === 'children')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Removes empty braces and writes plain strings as text, one at a time. Each
 * edit is kept only when the children still render the same with every edit
 * kept so far.
 */
function tidyChildren(
  children: readonly Child[],
  inElement: boolean,
  context: PassContext,
): boolean {
  const { code, s } = context;
  for (const child of children) {
    if (child.type === 'JSXText' && hasUnusualSpace(code.slice(child.start, child.end))) {
      return false;
    }
  }
  const parts: (Part | undefined)[] = [];
  for (const [index, child] of children.entries()) {
    if (child.type === 'JSXText') {
      parts.push({ raw: code.slice(child.start, child.end) });
    } else if (child.type === 'JSXExpressionContainer' && isEmpty(child, code)) {
      parts.push({ literal: '' });
    } else if (child.type === 'JSXExpressionContainer' && readString(child, code) !== undefined) {
      parts.push({ literal: readString(child, code) ?? '' });
    } else {
      parts.push({ other: index });
    }
  }
  const expected = render(parts, inElement);
  let changed = false;
  for (const [index, child] of children.entries()) {
    if (child.type !== 'JSXExpressionContainer') {
      continue;
    }
    const empty = isEmpty(child, code);
    const value = empty ? undefined : readString(child, code);
    if (!empty && (value === undefined || !isPlainText(value))) {
      continue;
    }
    // Without the braces, the texts on both sides meet, and a string joins them as text.
    const before = parts[index];
    parts[index] = empty ? undefined : { raw: value ?? '' };
    if (render(parts, inElement) === expected) {
      if (empty) {
        s.remove(child.start, child.end);
      } else {
        unwrapString(child, '', '', context);
      }
      changed = true;
    } else {
      parts[index] = before;
    }
  }
  return changed;
}

/** The one element a fragment holds, when everything else in it is line breaks or empty braces. */
function findOnlyElement(fragment: JSXFragment, code: string): JSXElement | undefined {
  let only: JSXElement | undefined;
  for (const child of fragment.children) {
    if (child.type === 'JSXElement') {
      if (only) {
        return undefined;
      }
      only = child;
    } else if (child.type === 'JSXText') {
      // Spaces without a line break are text: `<> <b /></>` renders a space.
      if (!/^[ \t\r\n]*$/.test(child.value) || cleanText(child.value) !== '') {
        return undefined;
      }
    } else if (!(child.type === 'JSXExpressionContainer' && isEmpty(child, code))) {
      return undefined;
    }
  }
  return only;
}

function tidyAttribute(attribute: JSXAttribute, context: PassContext): boolean {
  const { value } = attribute;
  if (value?.type !== 'JSXExpressionContainer' || !isTidyAttribute(attribute)) {
    return false;
  }
  const text = readString(value, context.code);
  if (text === undefined || !isPlainAttribute(text)) {
    return false;
  }
  unwrapString(value, '"', '"', context);
  return true;
}

/**
 * Whether a fragment is a branch of `? :`, or the right side of `&&`, `||`
 * or `??`, where the lowering of `<Show>` and `<Switch>` leaves them. There a
 * fragment around one element lowers the same as the element. Elsewhere,
 * such as a function's return, Solid's JSX transform writes different code.
 */
function isBranch(fragment: JSXFragment, context: PassContext): boolean {
  let node: Node = fragment;
  let parent = context.parents.get(node);
  while (parent?.type === 'ParenthesizedExpression') {
    node = parent;
    parent = context.parents.get(node);
  }
  if (parent?.type === 'ConditionalExpression') {
    return parent.consequent === node || parent.alternate === node;
  }
  return parent?.type === 'LogicalExpression' && parent.right === node;
}

export function tidyJSX(context: PassContext): boolean {
  let changed = false;
  const visit = (node: Node): void => {
    if (node.type === 'JSXFragment' && isBranch(node, context)) {
      const only = findOnlyElement(node, context.code);
      if (only) {
        // Everything around the element is line breaks or empty braces, so it all goes.
        context.s.remove(node.start, only.start);
        context.s.remove(only.end, node.end);
        changed = true;
        visit(only);
        return;
      }
    }
    const childrenFixed = node.type === 'JSXElement' && hasChildrenAttribute(node);
    if ((node.type === 'JSXElement' || node.type === 'JSXFragment') && !childrenFixed) {
      const inElement = node.type === 'JSXElement' && isIntrinsic(node);
      if (tidyChildren(node.children, inElement, context)) {
        changed = true;
      }
    }
    if (node.type === 'JSXAttribute' && tidyAttribute(node, context)) {
      changed = true;
      return;
    }
    forEachChild(node, visit);
  };
  visit(context.program);
  return changed;
}
