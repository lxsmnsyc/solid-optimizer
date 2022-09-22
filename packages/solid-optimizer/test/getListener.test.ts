import { describe, expect, it } from 'vitest';
import compile from './compile';

describe('getListener', () => {
  it('should work for ImportSpecifier', async () => {
    expect(await compile(`
      import { getListener } from 'solid-js';
      
      getListener();
    `)).toMatchSnapshot();
  });
  it('should work for aliased ImportSpecifier', async () => {
    expect(await compile(`
      import { getListener as x } from 'solid-js';
      
      x();
    `)).toMatchSnapshot();
  });
  it('should work for aliased string ImportSpecifier', async () => {
    expect(await compile(`
      import { 'getListener' as x } from 'solid-js';
      
      x();
    `)).toMatchSnapshot();
  });
  it('should work for namespace', async () => {
    expect(await compile(`
      import * as solid from 'solid-js';
      
      solid.getListener();
    `)).toMatchSnapshot();
  });
});
