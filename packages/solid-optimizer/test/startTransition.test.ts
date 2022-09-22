import { describe, expect, it } from 'vitest';
import compile from './compile';

describe('startTransition', () => {
  describe('callbacks w/o body', () => {
    it('should work for ImportSpecifier', async () => {
      expect(await compile(`
        import { startTransition } from 'solid-js';
        
        startTransition(() => update());
      `)).toMatchSnapshot();
    });
    it('should work for aliased ImportSpecifier', async () => {
      expect(await compile(`
        import { startTransition as x } from 'solid-js';
        
        x(() => update());
      `)).toMatchSnapshot();
    });
    it('should work for aliased string ImportSpecifier', async () => {
      expect(await compile(`
        import { 'startTransition' as x } from 'solid-js';
        
        x(() => update());
      `)).toMatchSnapshot();
    });
    it('should work for namespace', async () => {
      expect(await compile(`
        import * as solid from 'solid-js';
        
        solid.startTransition(() => update());
      `)).toMatchSnapshot();
    });
  });
  describe('callbacks with body', () => {
    it('should work for ImportSpecifier', async () => {
      expect(await compile(`
        import { startTransition } from 'solid-js';
        
        startTransition(() => {
          update();
        });
      `)).toMatchSnapshot();
    });
    it('should work for aliased ImportSpecifier', async () => {
      expect(await compile(`
        import { startTransition as x } from 'solid-js';
        
        x(() => {
          update();
        });
      `)).toMatchSnapshot();
    });
    it('should work for aliased string ImportSpecifier', async () => {
      expect(await compile(`
        import { 'startTransition' as x } from 'solid-js';
        
        x(() => {
          update();
        });
      `)).toMatchSnapshot();
    });
    it('should work for namespace', async () => {
      expect(await compile(`
        import * as solid from 'solid-js';
        
        solid.startTransition(() => {
          update();
        });
      `)).toMatchSnapshot();
    });
  });
  describe('spreads', () => {
    it('should work for ImportSpecifier', async () => {
      expect(await compile(`
        import { startTransition } from 'solid-js';
        
        startTransition(...example);
      `)).toMatchSnapshot();
    });
    it('should work for aliased ImportSpecifier', async () => {
      expect(await compile(`
        import { startTransition as x } from 'solid-js';
        
        x(...example);
      `)).toMatchSnapshot();
    });
    it('should work for aliased string ImportSpecifier', async () => {
      expect(await compile(`
        import { 'startTransition' as x } from 'solid-js';
        
        x(...example);
      `)).toMatchSnapshot();
    });
    it('should work for namespace', async () => {
      expect(await compile(`
        import * as solid from 'solid-js';
        
        solid.startTransition(...example);
      `)).toMatchSnapshot();
    });
  });
});
