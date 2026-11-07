/**
 * Helpers for replacing JSX children as text.
 *
 * Adjacent JSX text is one text node to the parser, and JSX trims a text
 * node as a whole: `a` and `b` on separate lines render as `ab` when an
 * element sits between them, but as `a b` once they are one text node. So
 * whenever a replacement would put two texts that were apart next to each
 * other, an empty `{}` keeps them apart.
 */
import type { JSXAttribute, JSXChild, JSXElement, JSXFragment, Node } from 'oxc-parser';
import type MagicString from 'magic-string';

/**
 * What a JSX child turns into.
 */
export interface Piece {
  /** The child the piece replaces. */
  readonly node: JSXChild;
  /** The replacement text, or `undefined` to keep the child as written. */
  text: string | undefined;
  /** The JSX text the piece starts with, or `undefined` when it starts with a tag or a container. */
  startText: string | undefined;
  /** The JSX text the piece ends with. */
  endText: string | undefined;
}

export function keptPiece(node: JSXChild): Piece {
  const text = node.type === 'JSXText' ? node.value : undefined;
  return { node, text: undefined, startText: text, endText: text };
}

/**
 * A piece that splices `children` in place of `node`.
 */
export function splicePiece(s: MagicString, node: JSXChild, children: readonly JSXChild[]): Piece {
  const first = children.at(0);
  const last = children.at(-1);
  if (!first || !last) {
    return replacedPiece(node, '');
  }
  return replacedPiece(node, s.slice(first.start, last.end));
}

/**
 * A piece that writes `text`, JSX children as source, in place of `node`.
 *
 * The texts it starts and ends with are read from `text` itself, not from
 * the children it came from. A fold inside them in the same round can have
 * turned a child that was an element into text, such as an inner `<Show>`.
 * JSX text holds no `<`, `>`, `{`, or `}`, so the first and last of those
 * mark where the text ends.
 */
export function replacedPiece(node: JSXChild, text: string): Piece {
  const start = text.search(/[<{]/);
  const end = Math.max(text.lastIndexOf('>'), text.lastIndexOf('}'));
  const startText = start === -1 ? text : text.slice(0, start);
  const endText = text.slice(end + 1);
  return {
    node,
    text,
    startText: startText === '' ? undefined : startText,
    endText: endText === '' ? undefined : endText,
  };
}

/** Whether JSX drops this text: whitespace that contains a line break. */
function isDroppedText(text: string): boolean {
  return /^\s*$/.test(text) && /[\r\n]/.test(text);
}

/**
 * Whether two texts render differently as one text node than apart.
 * Two texts that JSX drops, like line breaks and indentation, still drop together.
 */
function mergeChangesText(before: string | undefined, after: string | undefined): boolean {
  return (
    before !== undefined && after !== undefined && !(isDroppedText(before) && isDroppedText(after))
  );
}

/**
 * Puts `{}` between two pieces that meet as text, on whichever side is replaced.
 */
function separate(previous: Piece, next: Piece, emptiesBetween: readonly Piece[]): void {
  if (next.text !== undefined) {
    next.text = `{}${next.text}`;
    next.startText = undefined;
    return;
  }
  if (previous.text !== undefined) {
    previous.text = `${previous.text}{}`;
    previous.endText = undefined;
    return;
  }
  // Two kept texts only meet across a removed child.
  const empty = emptiesBetween.at(-1);
  if (empty) {
    empty.text = '{}';
  }
}

/**
 * Writes the replaced pieces of a child list, adding `{}` wherever two texts
 * would otherwise merge.
 */
export function writePieces(s: MagicString, pieces: readonly Piece[]): boolean {
  let changed = false;
  // The last piece that renders anything, and the empty pieces after it.
  let previous: Piece | undefined;
  let emptiesSincePrevious: Piece[] = [];
  for (const piece of pieces) {
    if (piece.text === '') {
      emptiesSincePrevious.push(piece);
      continue;
    }
    if (previous && mergeChangesText(previous.endText, piece.startText)) {
      separate(previous, piece, emptiesSincePrevious);
    }
    previous = piece;
    emptiesSincePrevious = [];
  }
  for (const piece of pieces) {
    if (piece.text === undefined) {
      continue;
    }
    changed = true;
    if (piece.text === '') {
      s.remove(piece.node.start, piece.node.end);
    } else {
      s.overwrite(piece.node.start, piece.node.end, piece.text);
    }
  }
  return changed;
}

export function findAttribute(element: JSXElement, name: string): JSXAttribute | undefined {
  for (const attribute of element.openingElement.attributes) {
    if (
      attribute.type === 'JSXAttribute' &&
      attribute.name.type === 'JSXIdentifier' &&
      attribute.name.name === name
    ) {
      return attribute;
    }
  }
  return undefined;
}

export function hasSpreadAttribute(element: JSXElement): boolean {
  for (const attribute of element.openingElement.attributes) {
    if (attribute.type === 'JSXSpreadAttribute') {
      return true;
    }
  }
  return false;
}

/**
 * Whether any child is a function, which the runtime may call with the
 * narrowed value. Folding one away would drop that call.
 */
export function hasCallbackChild(children: readonly JSXChild[]): boolean {
  for (const child of children) {
    if (child.type !== 'JSXExpressionContainer') {
      continue;
    }
    let expression: Node = child.expression;
    while (expression.type === 'ParenthesizedExpression') {
      expression = expression.expression;
    }
    if (expression.type === 'ArrowFunctionExpression' || expression.type === 'FunctionExpression') {
      return true;
    }
  }
  return false;
}

/**
 * The text between an element's tags, or an empty string for a self-closing element.
 */
export function innerText(s: MagicString, node: JSXElement | JSXFragment): string {
  if (node.type === 'JSXFragment') {
    return s.slice(node.openingFragment.end, node.closingFragment.start);
  }
  if (!node.closingElement) {
    return '';
  }
  return s.slice(node.openingElement.end, node.closingElement.start);
}
