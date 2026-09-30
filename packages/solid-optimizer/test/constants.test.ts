/**
 * Constants from other modules: what a module exports, and folding imports
 * of them.
 */
import { describe, expect, it } from 'vitest';
import { readModuleConstants } from '../src';
import { optimize } from './utils';

describe('readModuleConstants', () => {
  it('reads exported constants', () => {
    const { exports } = readModuleConstants(`
      const BASE = 'app';
      export const NAME = \`\${BASE}-demo\`;
      export const DEBUG = false, LEVEL = 2 * 3;
      export let COUNT = 1;
      export const OBJECT = { a: 1 };
      export const NOW = Date.now();
    `);
    expect(exports).toEqual({ NAME: 'app-demo', DEBUG: false, LEVEL: 6, COUNT: 1 });
  });

  it('skips a let the module writes to and a var', () => {
    const { exports } = readModuleConstants(`
      export let count = 1;
      export var legacy = 2;
      export function increment() { count += 1; }
    `);
    expect(exports).toEqual({});
  });

  it('reads names exported from a local binding', () => {
    const { exports } = readModuleConstants(`
      const a = 1;
      let b = 'b';
      export { a, a as one, b as 'string name' };
    `);
    expect(exports).toEqual({ a: 1, one: 1, 'string name': 'b' });
  });

  it('lists the modules it imports named bindings from', () => {
    const { imports } = readModuleConstants(
      `
      import { a } from './a';
      import b from './b';
      import * as c from './c';
      import type { D } from './d';
      import { type E } from './e';
      import './f';
      export { g } from './g';
      export type { H } from './h';
    `,
      { filename: 'input.ts' },
    );
    expect(imports).toEqual(['./a', './b', './g']);
  });

  it('reads constants it imports and re-exports', () => {
    const { exports } = readModuleConstants(
      `
      import { MODE as mode } from './env';
      export const PROD = mode === 'production';
      export { MODE, MISSING } from './env';
    `,
      { importedConstants: { './env': { MODE: 'production' } } },
    );
    expect(exports).toEqual({ PROD: true, MODE: 'production' });
  });
});

describe('importedConstants', () => {
  const importedConstants = { './config': { SHOW: false, THEME: 'dark', LIMIT: 3 } };

  it('folds control flow on imported constants', () => {
    const code = `
      import { Show } from 'solid-js';
      import { SHOW, THEME as theme } from './config';
      export function App() {
        return (
          <main>
            <Show when={SHOW} fallback={<p>hidden</p>}><p>shown</p></Show>
            <p class={theme === 'dark' ? 'dark' : 'light'} />
          </main>
        );
      }
    `;
    expect(optimize(code, { importedConstants })).toMatchInlineSnapshot(`
      "
            import { Show } from 'solid-js';
            import { SHOW, THEME as theme } from './config';
            export function App() {
              return (
                <main>
                  <p>hidden</p>
                  <p class={'dark'} />
                </main>
              );
            }
          "
    `);
  });

  it('leaves imports it has no value for', () => {
    const code = `
      import { OTHER } from './config';
      import * as config from './config';
      import LIMIT from './config';
      export const a = [OTHER, config.LIMIT, LIMIT];
    `;
    expect(optimize(code, { importedConstants })).toBe(code);
  });

  it('only folds imports from the same specifier', () => {
    const code = `
      import { SHOW } from './other/config';
      export const a = SHOW;
    `;
    expect(optimize(code, { importedConstants })).toBe(code);
  });
});
