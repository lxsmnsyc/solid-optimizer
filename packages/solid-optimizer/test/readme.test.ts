/**
 * The repository's README, which GitHub shows, is a copy of this package's,
 * which npm shows. Edit the package's and copy it over.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('keeps the root README a copy of the package README', () => {
  const read = (relative: string): string =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
  expect(read('../../../README.md')).toBe(read('../README.md'));
});
