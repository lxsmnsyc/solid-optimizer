import { defineConfig } from 'oxfmt';

export default defineConfig({
  singleQuote: true,
  // Changesets end up in the changelog as written.
  // The Hacker News app comes from another repository, and keeps its formatting.
  // Debate evidence is kept as it ran, and debate.py writes the ledgers.
  ignorePatterns: [
    '**/dist/**',
    '.changeset/**/*.md',
    'pnpm-lock.yaml',
    'examples/hackernews/src/**',
    'examples/hackernews/public/**',
    'debates/*/evidence/**',
    'debates/**/*.json',
  ],
});
