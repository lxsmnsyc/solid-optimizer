/**
 * Helpers for replacing JSX children as text.
 *
 * Adjacent JSX text is one text node to the parser, and JSX trims a text
 * node as a whole: `a` and `b` on separate lines render as `ab` when an
 * element sits between them, but as `a b` once they are one text node. So
 * whenever a replacement would put two texts that were apart next to each
 * other, an empty `{}` keeps them apart.
 */
import type { JSXAttribute, JSXChild, JSXElement, JSXFragment, JSXText, Node } from 'oxc-parser';
import { isFilteredText } from './ast';
import type MagicString from 'magic-string';

/**
 * What a JSX child turns into.
 */
export interface Piece {
  /** The child the piece replaces. */
  readonly node: JSXChild;
  /** The replacement text, or `undefined` to keep the child as written. */
  text: string | undefined;
  /** The JSX text the replacement starts with. */
  startText: JSXText | undefined;
  /** The JSX text the replacement ends with. */
  endText: JSXText | undefined;
}

export function keptPiece(node: JSXChild): Piece {
  const text = node.type === 'JSXText' ? node : undefined;
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
  return {
    node,
    text: s.slice(first.start, last.end),
    startText: first.type === 'JSXText' ? first : undefined,
    endText: last.type === 'JSXText' ? last : undefined,
  };
}

export function replacedPiece(node: JSXChild, text: string): Piece {
  return { node, text, startText: undefined, endText: undefined };
}

/**
 * Whether two texts render differently as one text node than apart.
 * Two texts that JSX drops, like line breaks and indentation, still drop together.
 */
function mergeChangesText(before: JSXText | undefined, after: JSXText | undefined): boolean {
  return (
    before !== undefined &&
    after !== undefined &&
    !(isFilteredText(before) && isFilteredText(after))
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
  return element.openingElement.attributes.some(
    (attribute) => attribute.type === 'JSXSpreadAttribute',
  );
}

/**
 * Whether any child is a function, which the runtime may call with the
 * narrowed value. Folding one away would drop that call.
 */
export function hasCallbackChild(children: readonly JSXChild[]): boolean {
  return children.some((child) => {
    if (child.type !== 'JSXExpressionContainer') {
      return false;
    }
    let expression: Node = child.expression;
    while (expression.type === 'ParenthesizedExpression') {
      expression = expression.expression;
    }
    return (
      expression.type === 'ArrowFunctionExpression' || expression.type === 'FunctionExpression'
    );
  });
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
