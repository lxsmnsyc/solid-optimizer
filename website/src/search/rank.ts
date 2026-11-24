// Finds entries for a query and ranks them: a title match comes before a heading match, and a
// heading match before a text match. Inside a field a word that starts with the term beats a word
// that shares its stem ("resume" and "resuming"), and that beats a match in the middle of a word.
// The build does not use this file: only the command bar and the tests do.
import type { Entry } from './entry.ts';

export interface Result {
  entry: Entry;
  score: number;
  /** The text to show under the title: the start of the section, or a snippet around a match. */
  detail: string;
}

const TITLE = 100;
const HEADING = 50;
const TEXT = 10;
const PER_PAGE = 3;
/** The shortest prefix that two words share for the terms to count as forms of one word. */
const PREFIX = 5;
const STEM_STRENGTH = 0.8;
const INSIDE_STRENGTH = 0.3;
const SUFFIXES = ['ing', 'ment', 'ion', 'es', 's', 'e'];

/** The words of a query, lower case. */
export function splitTerms(query: string): string[] {
  const terms: string[] = [];
  for (const term of query.toLowerCase().split(/\s+/)) {
    if (term !== '') {
      terms.push(term);
    }
  }
  return terms;
}

/** The words of a field, lower case. */
function splitWords(field: string): string[] {
  const words: string[] = [];
  for (const word of field.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word !== '') {
      words.push(word);
    }
  }
  return words;
}

/** A word without its common endings, so "resume" and "resuming" meet at "resum". */
function stem(word: string): string {
  let result = word;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of SUFFIXES) {
      if (result.endsWith(suffix) && result.length - suffix.length >= 4) {
        result = result.slice(0, -suffix.length);
        changed = true;
      }
    }
  }
  return result;
}

function sharedPrefix(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) {
    length += 1;
  }
  return length;
}

/** How well one word matches a term, from 0 to 1. */
function wordStrength(word: string, term: string): number {
  if (word.startsWith(term)) {
    return 1;
  }
  if (stem(word) === stem(term) || sharedPrefix(word, term) >= PREFIX) {
    return STEM_STRENGTH;
  }
  return 0;
}

interface Match {
  /** The best strength of a word, from 0 to 1. */
  strength: number;
  /** The words that match as a whole word or as a form of the term. */
  count: number;
  /** Whether the best match is the first word of the field. */
  first: boolean;
}

/** How a term matches a field. A match in the middle of a word counts least. */
function matchField(field: string, term: string): Match {
  let strength = 0;
  let count = 0;
  let first = false;
  for (const [at, word] of splitWords(field).entries()) {
    const found = wordStrength(word, term);
    if (found > 0) {
      count += 1;
      if (found > strength) {
        strength = found;
        first = at === 0;
      }
    }
  }
  if (strength === 0 && field.toLowerCase().includes(term)) {
    strength = INSIDE_STRENGTH;
  }
  return { strength, count, first };
}

/** The title of an entry: the page title for the page itself, and the heading for a section. */
export function titleOf(entry: Entry): string {
  return entry.id === '' ? entry.pageTitle : entry.heading;
}

/** A snippet of the text around the first of the terms that it holds. */
function snippet(text: string, terms: readonly string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) {
      at = found;
    }
  }
  const start = Math.max(0, at - 24);
  const piece = text.slice(start, start + 110).trim();
  return `${start > 0 ? '…' : ''}${piece}${start + 110 < text.length ? '…' : ''}`;
}

/** Whether the field holds every term. */
export function holdsAll(field: string, terms: readonly string[]): boolean {
  for (const term of terms) {
    if (matchField(field, term).strength === 0) {
      return false;
    }
  }
  return true;
}

/** Scores an entry, or gives 0 when a term matches none of its fields. */
function scoreEntry(entry: Entry, terms: readonly string[]): number {
  const title = titleOf(entry);
  const weight = entry.id === '' ? TITLE : HEADING;
  let score = 0;
  for (const term of terms) {
    const inTitle = matchField(title, term);
    if (inTitle.strength > 0) {
      score += weight * inTitle.strength + (inTitle.first ? 6 : 0);
      continue;
    }
    const inText = matchField(entry.text, term);
    if (inText.strength === 0) {
      return 0;
    }
    // A term that comes up often in the text breaks a tie between two sections.
    score += TEXT * inText.strength + Math.min(inText.count, 9) / 10;
  }
  return score;
}

/**
 * The entries that hold every term, best first, with at most three per page so one page does not
 * fill the list. A tie keeps the order of the index, which is the order of the sidebar.
 */
export function search(entries: readonly Entry[], query: string, limit = 8): Result[] {
  const terms = splitTerms(query);
  if (terms.length === 0) {
    return [];
  }
  const scored: Result[] = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, terms);
    if (score > 0) {
      const detail = holdsAll(titleOf(entry), terms)
        ? snippet(entry.text, [])
        : snippet(entry.text, terms);
      scored.push({ entry, score, detail });
    }
  }
  // `toSorted` is stable.
  const ranked = scored.toSorted((a, b) => b.score - a.score);
  const results: Result[] = [];
  const perPage = new Map<string, number>();
  for (const result of ranked) {
    const count = perPage.get(result.entry.page) ?? 0;
    if (count < PER_PAGE) {
      perPage.set(result.entry.page, count + 1);
      results.push(result);
    }
    if (results.length === limit) {
      break;
    }
  }
  return results;
}

/**
 * The strings to highlight for the terms: each term, its stem and its first five letters, so
 * "resume" marks the start of "Resuming".
 */
export function markTerms(terms: readonly string[]): string[] {
  const marks = new Set<string>();
  for (const term of terms) {
    marks.add(term);
    marks.add(stem(term));
    if (term.length > PREFIX) {
      marks.add(term.slice(0, PREFIX));
    }
  }
  return [...marks];
}
