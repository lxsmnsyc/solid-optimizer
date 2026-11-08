import type { DecodedSourceMap, SourceMapSegment } from '@jridgewell/remapping';
import MagicString from 'magic-string';

// Each character of a text has an origin, written as two UTF-16 code units
// that hold a 32-bit value:
// - an offset in the pass's input that the character was copied from,
// - `WRITTEN | offset` for a character a pass wrote at that offset, or
// - `LOOSE` for a character that takes the offset of the edit it ends up in.
const WRITTEN = 0x8000_0000;
const LOOSE = 0xffff_ffff;
const LOOSE_UNITS = '\uffff\uffff';

function encodeOrigin(value: number): string {
  return String.fromCharCode(value >>> 16, value & 0xffff);
}

function decodeOrigin(origins: string, index: number): number {
  return ((origins.charCodeAt(index * 2) << 16) | origins.charCodeAt(index * 2 + 1)) >>> 0;
}

function repeatOrigin(value: number, length: number): string {
  return encodeOrigin(value).repeat(length);
}

/** The line of the original that holds an offset. */
function findLine(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((lineStarts[middle] ?? 0) <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

// The passes of one compile and the copies of one pass start from the same
// code, so the last identity is kept.
let identityCode: string | undefined;
let identity = '';

/** The origins of unedited code: each character its own offset. */
function createIdentity(code: string): string {
  if (identityCode === code) {
    return identity;
  }
  const chunks: string[] = [];
  const units = new Uint16Array(Math.min(code.length, 4096) * 2);
  for (let start = 0; start < code.length; start += 4096) {
    const end = Math.min(code.length, start + 4096);
    for (let index = start; index < end; index += 1) {
      units[(index - start) * 2] = index >>> 16;
      units[(index - start) * 2 + 1] = index & 0xffff;
    }
    chunks.push(String.fromCharCode(...units.subarray(0, (end - start) * 2)));
  }
  identityCode = code;
  identity = chunks.join('');
  return identity;
}

/**
 * Code with the origin of each of its characters, so that the source map
 * can point a copied character back at the one it copies.
 *
 * `origins` is `undefined` when the compile writes no source map.
 */
export class Text {
  constructor(
    readonly code: string,
    readonly origins: string | undefined,
  ) {}

  toString(): string {
    return this.code;
  }
}

export type Content = Text | string;

/** The code of a content. */
export function getCode(content: Content): string {
  return typeof content === 'string' ? content : content.code;
}

/**
 * Joins contents into one text. The characters of a string take the offset
 * of the edit that writes the text.
 */
export function join(parts: readonly Content[], separator = ''): Text {
  let code = '';
  let origins: string | undefined = '';
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? '';
    if (index > 0 && separator) {
      code += separator;
      if (origins !== undefined) {
        origins += repeatOrigin(LOOSE, separator.length);
      }
    }
    if (typeof part === 'string') {
      code += part;
      if (origins !== undefined) {
        origins += repeatOrigin(LOOSE, part.length);
      }
    } else {
      code += part.code;
      // A text without origins comes from a compile that writes no map.
      origins = part.origins === undefined ? undefined : origins + part.origins;
    }
  }
  return new Text(code, origins);
}

/** Builds a text from a template, keeping the origins of the texts it holds. */
export function joinText(strings: TemplateStringsArray, ...values: readonly Content[]): Text {
  const parts: Content[] = [];
  for (let index = 0; index < strings.length; index += 1) {
    parts.push(strings[index] ?? '');
    if (index < values.length) {
      parts.push(values[index] ?? '');
    }
  }
  return join(parts);
}

/** The origins of a content written at an offset. */
function resolveOrigins(content: Content, at: number): string {
  if (typeof content === 'string') {
    return repeatOrigin(WRITTEN | at, content.length);
  }
  const { origins } = content;
  if (origins === undefined) {
    return repeatOrigin(WRITTEN | at, content.code.length);
  }
  // Only an origin that starts at an even unit is one; an odd match spans two.
  let result = '';
  let from = 0;
  const written = encodeOrigin(WRITTEN | at);
  let found = origins.indexOf(LOOSE_UNITS);
  while (found !== -1) {
    if (found % 2 === 1) {
      found = origins.indexOf(LOOSE_UNITS, found + 1);
      continue;
    }
    result += origins.slice(from, found) + written;
    from = found + 2;
    found = origins.indexOf(LOOSE_UNITS, from);
  }
  return from === 0 ? origins : result + origins.slice(from);
}

/**
 * Edits code like `MagicString`, and keeps the origin of each character of
 * the result.
 *
 * A second `MagicString` holds the origins, two code units per character,
 * and takes every edit the first one takes.
 */
export class Editor {
  private readonly s: MagicString;
  /** The origins, made at the first edit, since most passes change nothing. */
  private o: MagicString | undefined;

  constructor(
    readonly original: string,
    private readonly tracksOrigins: boolean,
  ) {
    this.s = new MagicString(original);
  }

  /** A new editor on the same original code, which keeps origins when this one does. */
  fresh(): Editor {
    return new Editor(this.original, this.tracksOrigins);
  }

  /** The origins to edit, or `undefined` when this editor keeps none. */
  private editOrigins(): MagicString | undefined {
    if (this.tracksOrigins && !this.o) {
      this.o = new MagicString(createIdentity(this.original));
    }
    return this.o;
  }

  /** Code that a pass writes in place of what is at `at`, mapped there. */
  written(code: string, at: number): Text {
    return new Text(code, this.tracksOrigins ? repeatOrigin(WRITTEN | at, code.length) : undefined);
  }

  overwrite(start: number, end: number, content: Content): this {
    this.s.overwrite(start, end, getCode(content));
    this.editOrigins()?.overwrite(start * 2, end * 2, resolveOrigins(content, start));
    return this;
  }

  remove(start: number, end: number): this {
    this.s.remove(start, end);
    this.editOrigins()?.remove(start * 2, end * 2);
    return this;
  }

  prependLeft(index: number, content: Content): this {
    this.s.prependLeft(index, getCode(content));
    this.editOrigins()?.prependLeft(index * 2, resolveOrigins(content, index));
    return this;
  }

  prependRight(index: number, content: Content): this {
    this.s.prependRight(index, getCode(content));
    this.editOrigins()?.prependRight(index * 2, resolveOrigins(content, index));
    return this;
  }

  appendLeft(index: number, content: Content): this {
    this.s.appendLeft(index, getCode(content));
    this.editOrigins()?.appendLeft(index * 2, resolveOrigins(content, index));
    return this;
  }

  /** The edited code of characters `start` to `end` of the original, with origins. */
  slice(start: number, end: number): Text {
    let origins: string | undefined;
    if (this.o) {
      origins = this.o.slice(start * 2, end * 2);
    } else if (this.tracksOrigins) {
      origins = createIdentity(this.original).slice(start * 2, end * 2);
    }
    return new Text(this.s.slice(start, end), origins);
  }

  toString(): string {
    return this.s.toString();
  }

  /**
   * A map from the edited code to the original. A copied character maps to
   * the one it copies, and a written run maps to where it was written.
   */
  generateMap(source: string): DecodedSourceMap {
    const code = this.s.toString();
    const origins = this.o?.toString() ?? createIdentity(this.original);

    // Where each line of the original starts, to turn an offset into a line and column.
    const lineStarts = [0];
    for (let index = 0; index < this.original.length; index += 1) {
      if (this.original.charCodeAt(index) === 10) {
        lineStarts.push(index + 1);
      }
    }

    // Each copied character maps to its own, and a written run maps from its
    // first character on each line. A copied run continues on the line of
    // the character before it, so only a jump needs a search.
    const mappings: SourceMapSegment[][] = [[]];
    let line = mappings[0] ?? [];
    let column = 0;
    // No origin is `LOOSE` here, so the first character never continues a run.
    let previous = LOOSE;
    let sourceLine = 0;
    let sourceColumn = 0;
    for (let index = 0; index < code.length; index += 1) {
      const origin = decodeOrigin(origins, index);
      if (origin < WRITTEN) {
        if (origin === previous + 1 && this.original.charCodeAt(previous) !== 10) {
          sourceColumn += 1;
        } else {
          sourceLine = findLine(lineStarts, origin);
          sourceColumn = origin - (lineStarts[sourceLine] ?? 0);
        }
        line.push([column, 0, sourceLine, sourceColumn]);
      } else if (origin !== previous || column === 0) {
        const offset = origin - WRITTEN;
        const written = findLine(lineStarts, offset);
        line.push([column, 0, written, offset - (lineStarts[written] ?? 0)]);
      }
      previous = origin;
      if (code.charCodeAt(index) === 10) {
        line = [];
        mappings.push(line);
        column = 0;
      } else {
        column += 1;
      }
    }
    return {
      version: 3,
      file: null,
      names: [],
      sources: [source],
      sourcesContent: [this.original],
      mappings,
    };
  }
}
