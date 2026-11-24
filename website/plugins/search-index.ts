/**
 * Builds the search index at build time, adapted from the idlip site: one
 * entry per heading, and one for the page itself with its lead and the text
 * before its first heading. Entries follow the sidebar order, so ties rank in
 * reading order.
 */
import type { Entry } from '../src/search/entry.ts';

interface IndexedDoc {
  slug: string;
  title: string;
  description: string;
  html: string;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** The text of an HTML fragment: no code blocks (inline code stays), no buttons, labels or anchors. */
export function htmlToText(html: string): string {
  return html
    .replaceAll(/<pre\b[\s\S]*?<\/pre>/g, ' ')
    .replaceAll(/<button\b[^>]*>[\s\S]*?<\/button>/g, ' ')
    .replaceAll(/<span class="(?:code-lang|code-block-name|compare-label)">[\s\S]*?<\/span>/g, ' ')
    .replaceAll(/<a class="heading-anchor"[^>]*>[\s\S]*?<\/a>/g, ' ')
    .replaceAll(/<svg\b[\s\S]*?<\/svg>/g, ' ')
    .replaceAll(/<\/(?:p|li|pre|tr|td|th|h[1-6]|div|ul|ol|table)>|<br\s*\/?>/g, ' ')
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** The address of a doc relative to the site's base: `docs/guides/report/`. */
function addressOf(slug: string): string {
  return slug === '' ? 'docs/' : `docs/${slug}/`;
}

function buildDocEntries(doc: IndexedDoc): Entry[] {
  const entries: Entry[] = [];
  const page = addressOf(doc.slug);
  let heading = '';
  let id = '';
  let from = 0;
  function push(to: number): void {
    const text = htmlToText(doc.html.slice(from, to));
    entries.push({
      page,
      pageTitle: doc.title,
      heading,
      id,
      // The page's own entry starts with its lead, which the layout prints above the body.
      text: id === '' ? `${doc.description} ${text}`.trim() : text,
    });
  }
  for (const match of doc.html.matchAll(/<h[2-6] id="([^"]*)">([\s\S]*?)<\/h[2-6]>/g)) {
    push(match.index);
    heading = htmlToText(match[2]);
    id = match[1];
    from = match.index + match[0].length;
  }
  push(doc.html.length);
  return entries;
}

/** The entries of every doc, in the order given. */
export function buildSearchIndex(docs: readonly IndexedDoc[]): Entry[] {
  const entries: Entry[] = [];
  for (const doc of docs) {
    entries.push(...buildDocEntries(doc));
  }
  return entries;
}
