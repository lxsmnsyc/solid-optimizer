import { describe, expect, it } from 'vitest';
import compile from './compile';

describe('createDeferred', () => {
  describe('Expression arguments', () => {
    it('should work for ImportSpecifier', async () => {
      expect(await compile(`
        import { createDeferred } from 'solid-js';
        
        createDeferred(() => update());
      `)).toMatchSnapshot();
    });
    it('should work for aliased ImportSpecifier', async () => {
      expect(await compile(`
        import { createDeferred as x } from 'solid-js';
        
        x(() => update());
      `)).toMatchSnapshot();
    });
    it('should work for aliased string ImportSpecifier', async () => {
      expect(await compile(`
        import { 'createDeferred' as x } from 'solid-js';
        
        x(() => update());
      `)).toMatchSnapshot();
    });
    it('should work for namespace', async () => {
      expect(await compile(`
        import * as solid from 'solid-js';
        
        solid.createDeferred(() => update());
      `)).toMatchSnapshot();
    });
  });
  describe('spreads', () => {
    it('should work for ImportSpecifier', async () => {
      expect(await compile(`
        import { createDeferred } from 'solid-js';
        
        createDeferred(...example);
      `)).toMatchSnapshot();
    });
    it('should work for aliased ImportSpecifier', async () => {
      expect(await compile(`
        import { createDeferred as x } from 'solid-js';
        
        x(...example);
      `)).toMatchSnapshot();
    });
    it('should work for aliased string ImportSpecifier', async () => {
      expect(await compile(`
        import { 'createDeferred' as x } from 'solid-js';
        
        x(...example);
      `)).toMatchSnapshot();
    });
    it('should work for namespace', async () => {
      expect(await compile(`
        import * as solid from 'solid-js';
        
        solid.createDeferred(...example);
      `)).toMatchSnapshot();
    });
  });
});
