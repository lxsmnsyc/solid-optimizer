/**
 * The docs in sidebar order. Every doc must be listed here, by its slug: its
 * path under `src/content/docs` without `.md`, with '' for `index.md`.
 * Concepts come after the pages they need; guides follow a project's stages.
 */
export interface SidebarSection {
  title: string;
  slugs: string[];
}

export const SIDEBAR: SidebarSection[] = [
  {
    title: 'Getting started',
    slugs: [''],
  },
  {
    title: 'Guides',
    slugs: ['guides/vite-plugin', 'guides/report', 'guides/packages', 'guides/compile-api'],
  },
  {
    title: 'Concepts',
    slugs: [
      'concepts/how-it-works',
      'concepts/hydration',
      'concepts/modes',
      'concepts/cross-module',
    ],
  },
  {
    title: 'Passes',
    slugs: [
      'concepts/component-inlining',
      'concepts/context-inlining',
      'concepts/memo-inlining',
      'concepts/show-switch',
      'concepts/folding',
    ],
  },
  {
    title: 'Reference',
    slugs: ['reference/vite-options', 'reference/compile', 'reference/reasons', 'reference/errors'],
  },
];
