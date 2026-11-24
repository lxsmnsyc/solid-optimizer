import manifest from 'virtual:docs-manifest';
import { SIDEBAR } from '../content/sidebar';

export type DocMeta = (typeof manifest)[number];

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

export interface RenderedDoc extends DocMeta {
  html: string;
  headings: Heading[];
}

export interface DocLink extends DocMeta {
  href: string;
}

export interface DocSection {
  title: string;
  pages: DocLink[];
}

export function hrefOf(slug: string): string {
  return slug === '' ? '/docs/' : `/docs/${slug}/`;
}

function findMeta(slug: string): DocMeta | undefined {
  for (const entry of manifest) {
    if (entry.slug === slug) {
      return entry;
    }
  }
  return undefined;
}

function buildSections(): DocSection[] {
  const listed = new Set<string>();
  const sections: DocSection[] = [];
  for (const section of SIDEBAR) {
    const pages: DocLink[] = [];
    for (const slug of section.slugs) {
      const meta = findMeta(slug);
      if (!meta) {
        throw new Error(`The sidebar lists "${slug}", which has no doc.`);
      }
      listed.add(slug);
      pages.push({ ...meta, href: hrefOf(slug) });
    }
    sections.push({ title: section.title, pages });
  }
  for (const entry of manifest) {
    if (!listed.has(entry.slug)) {
      throw new Error(`The doc "${entry.slug}" is not in the sidebar.`);
    }
  }
  return sections;
}

export const SECTIONS: DocSection[] = buildSections();

/** Every doc in sidebar order. */
export const PAGES: DocLink[] = SECTIONS.flatMap((section) => section.pages);

export function findPage(slug: string): DocLink | undefined {
  for (const page of PAGES) {
    if (page.slug === slug) {
      return page;
    }
  }
  return undefined;
}

/** The docs before and after `slug` in sidebar order, for the pager. */
export function findSiblings(slug: string): { previous?: DocLink; next?: DocLink } {
  const index = PAGES.findIndex((page) => page.slug === slug);
  return { previous: PAGES[index - 1], next: PAGES[index + 1] };
}

export function findSectionTitle(slug: string): string | undefined {
  for (const section of SECTIONS) {
    for (const page of section.pages) {
      if (page.slug === slug) {
        return section.title;
      }
    }
  }
  return undefined;
}

/** The docs, keyed by slug. Each loads only when its page needs it. */
const MODULES: Partial<Record<string, () => Promise<{ doc: RenderedDoc }>>> = import.meta.glob<{
  doc: RenderedDoc;
}>('../content/docs/**/*.md');

export async function loadDoc(slug: string): Promise<RenderedDoc | undefined> {
  const file = slug === '' ? 'index' : slug;
  const load = MODULES[`../content/docs/${file}.md`] ?? MODULES[`../content/docs/${file}/index.md`];
  return load ? (await load()).doc : undefined;
}
