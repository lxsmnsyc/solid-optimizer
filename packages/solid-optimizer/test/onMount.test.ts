import { describe, expect, it } from 'vitest';
import compile from './compile';

describe('onMount', () => {
  it('should work for ImportSpecifier', async () => {
    expect(await compile(`
      import { onMount } from 'solid-js';
      
      onMount(() => {
        console.log('Hello World');
      });
    `)).toMatchSnapshot();
  });
  it('should work for aliased ImportSpecifier', async () => {
    expect(await compile(`
      import { onMount as x } from 'solid-js';
      
      x(() => {
        console.log('Hello World');
      });
    `)).toMatchSnapshot();
  });
  it('should work for aliased string ImportSpecifier', async () => {
    expect(await compile(`
      import { 'onMount' as x } from 'solid-js';
      
      x(() => {
        console.log('Hello World');
      });
    `)).toMatchSnapshot();
  });
  it('should work for namespace', async () => {
    expect(await compile(`
      import * as solid from 'solid-js';
      
      solid.onMount(() => {
        console.log('Hello World');
      });
    `)).toMatchSnapshot();
  });
});
