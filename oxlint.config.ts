import config from '@lxsmnsyc/oxlint-config';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [config],
  ignorePatterns: [
    '**/dist/**',
    '**/node_modules/**',
    // Test fixtures are sample apps for the Vite plugin, compiled without JSX types.
    '**/test/fixtures/**',
    // The showcase source is untyped JSX, so it reads short in the comparison image.
    'examples/showcase/App.jsx',
    // The Hacker News app is untyped JavaScript from another repository, kept as it was written.
    'examples/hackernews/src/**',
  ],
  rules: {
    // Modules use named exports, even when they have one export.
    'import/prefer-default-export': 'off',
  },
  overrides: [
    {
      // Example components return JSX, and spelling out the return type adds noise to the demos.
      files: ['examples/**'],
      rules: {
        'typescript/explicit-function-return-type': 'off',
        'typescript/explicit-module-boundary-types': 'off',
      },
    },
  ],
});
