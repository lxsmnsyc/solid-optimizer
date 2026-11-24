// The words and markup of the messages in the command bar, as strings, so tests can read them.

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"']/g, (character) => ENTITIES[character] ?? character);
}

/** The message of the empty state. */
export function emptyMessage(query: string): string {
  return `No results for “${query.trim()}”`;
}

/** The count that a screen reader hears: empty for an empty query, so the start list is silent. */
export function resultsStatus(query: string, count: number): string {
  const text = query.trim();
  if (text === '') {
    return '';
  }
  return `${count} ${count === 1 ? 'result' : 'results'} for ${text}`;
}

/** The empty state: the message, and a link to the guide when the page of the guide is known. */
export function renderEmpty(query: string, guide: string | undefined): string {
  const link = guide === undefined ? '' : ` <a href="${escapeHtml(guide)}">Read the guide</a>`;
  return `${escapeHtml(emptyMessage(query))}.${link}`;
}
