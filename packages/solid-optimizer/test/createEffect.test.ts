import { describe, expect, it } from 'vitest';
import compile from './compile';

describe('createEffect', () => {
  it('should work for ImportSpecifier', async () => {
    expect(await compile(`
      import { createEffect } from 'solid-js';
      
      createEffect(() => {
        console.log('Hello World');
      });
    `)).toMatchSnapshot();
  });
  it('should work for aliased ImportSpecifier', async () => {
    expect(await compile(`
      import { createEffect as x } from 'solid-js';
      
      x(() => {
        console.log('Hello World');
      });
    `)).toMatchSnapshot();
  });
  it('should work for aliased string ImportSpecifier', async () => {
    expect(await compile(`
      import { 'createEffect' as x } from 'solid-js';
      
      x(() => {
        console.log('Hello World');
      });
    `)).toMatchSnapshot();
  });
  it('should work for namespace', async () => {
    expect(await compile(`
      import * as solid from 'solid-js';
      
      solid.createEffect(() => {
        console.log('Hello World');
      });
    `)).toMatchSnapshot();
  });
});
