import config from '@lxsmnsyc/oxlint-config';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [config],
  ignorePatterns: [
    '**/dist/**',
    '**/node_modules/**',
    // Test fixtures are sample apps for the Vite plugin, compiled without JSX types.
    '**/test/fixtures/**',
  ],
  rules: {
    // Modules use named exports, even when they have one export.
    'import/prefer-default-export': 'off',
  },
});
