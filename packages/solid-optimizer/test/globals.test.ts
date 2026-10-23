import { resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import { sharedGlobals } from '../src/vite/globals';

describe('sharedGlobals', () => {
  it('keeps define entries and env values every environment shares', async () => {
    const config = await resolveConfig(
      {
        configFile: false,
        mode: 'production',
        define: {
          __DEBUG__: 'false',
          __VERSION__: JSON.stringify('1.2.0'),
          __TARGET__: '"browser"',
          // Code, not a value.
          __NOW__: 'Date.now()',
        },
        // The server build replaces this one differently, so it never folds.
        environments: { ssr: { define: { __TARGET__: '"node"' } } },
      },
      'build',
    );
    const globals = sharedGlobals(config);
    expect(globals).toMatchObject({
      __DEBUG__: false,
      __VERSION__: '1.2.0',
      'import.meta.env.MODE': 'production',
    });
    expect(globals).not.toHaveProperty('__TARGET__');
    expect(globals).not.toHaveProperty('__NOW__');
    expect(globals).not.toHaveProperty('import.meta.env.SSR');
  });

  it('never folds import.meta.env.SSR', () => {
    const globals = sharedGlobals({
      env: { SSR: false, MODE: 'production' },
      define: {},
      environments: {},
    });
    expect(globals).toEqual({ 'import.meta.env.MODE': 'production' });
  });
});
