import type { RenderedDoc } from './docs';

/** Every doc, loaded at once. Only the server imports this; the client loads one doc per page. */
const MODULES: Partial<Record<string, { doc: RenderedDoc }>> = import.meta.glob<{
  doc: RenderedDoc;
}>('../content/docs/**/*.md', { eager: true });

export function findDoc(slug: string): RenderedDoc | undefined {
  const file = slug === '' ? 'index' : slug;
  return (MODULES[`../content/docs/${file}.md`] ?? MODULES[`../content/docs/${file}/index.md`])
    ?.doc;
}
