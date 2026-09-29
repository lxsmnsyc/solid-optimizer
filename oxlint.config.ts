import config from '@lxsmnsyc/oxlint-config';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [config],
  ignorePatterns: ['**/dist/**', '**/node_modules/**'],
  rules: {
    // Modules use named exports, even when they have one export.
    'import/prefer-default-export': 'off',
  },
});
