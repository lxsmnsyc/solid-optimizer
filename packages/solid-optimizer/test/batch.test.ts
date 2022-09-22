import { describe, expect, it } from 'vitest';
import compile from './compile';

describe('batch', () => {
  describe('callbacks w/o body', () => {
    it('should work for ImportSpecifier', async () => {
      expect(await compile(`
        import { batch } from 'solid-js';
        
        batch(() => update());
      `)).toMatchSnapshot();
    });
    it('should work for aliased ImportSpecifier', async () => {
      expect(await compile(`
        import { batch as x } from 'solid-js';
        
        x(() => update());
      `)).toMatchSnapshot();
    });
    it('should work for aliased string ImportSpecifier', async () => {
      expect(await compile(`
        import { 'batch' as x } from 'solid-js';
        
        x(() => update());
      `)).toMatchSnapshot();
    });
    it('should work for namespace', async () => {
      expect(await compile(`
        import * as solid from 'solid-js';
        
        solid.batch(() => update());
      `)).toMatchSnapshot();
    });
  });
  describe('callbacks with body', () => {
    it('should work for ImportSpecifier', async () => {
      expect(await compile(`
        import { batch } from 'solid-js';
        
        batch(() => {
          update();
        });
      `)).toMatchSnapshot();
    });
    it('should work for aliased ImportSpecifier', async () => {
      expect(await compile(`
        import { batch as x } from 'solid-js';
        
        x(() => {
          update();
        });
      `)).toMatchSnapshot();
    });
    it('should work for aliased string ImportSpecifier', async () => {
      expect(await compile(`
        import { 'batch' as x } from 'solid-js';
        
        x(() => {
          update();
        });
      `)).toMatchSnapshot();
    });
    it('should work for namespace', async () => {
      expect(await compile(`
        import * as solid from 'solid-js';
        
        solid.batch(() => {
          update();
        });
      `)).toMatchSnapshot();
    });
  });
  describe('spreads', () => {
    it('should work for ImportSpecifier', async () => {
      expect(await compile(`
        import { batch } from 'solid-js';
        
        batch(...example);
      `)).toMatchSnapshot();
    });
    it('should work for aliased ImportSpecifier', async () => {
      expect(await compile(`
        import { batch as x } from 'solid-js';
        
        x(...example);
      `)).toMatchSnapshot();
    });
    it('should work for aliased string ImportSpecifier', async () => {
      expect(await compile(`
        import { 'batch' as x } from 'solid-js';
        
        x(...example);
      `)).toMatchSnapshot();
    });
    it('should work for namespace', async () => {
      expect(await compile(`
        import * as solid from 'solid-js';
        
        solid.batch(...example);
      `)).toMatchSnapshot();
    });
  });
});
