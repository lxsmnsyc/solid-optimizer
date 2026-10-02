import { defineConfig } from 'oxfmt';

export default defineConfig({
  singleQuote: true,
  // Changesets end up in the changelog as written.
  // The Hacker News app comes from another repository, and keeps its formatting.
  ignorePatterns: [
    '**/dist/**',
    '.changeset/*.md',
    'pnpm-lock.yaml',
    'examples/hackernews/src/**',
    'examples/solid-ui/src/**',
    'examples/hackernews/public/**',
  ],
});
