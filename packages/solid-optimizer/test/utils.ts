import { transform } from '@solidjs/compiler';
import type { CompileOptions } from '../src';
import { compile } from '../src';

/**
 * Optimizes JSX and returns the JSX that comes out.
 */
export function optimize(code: string, options: CompileOptions = {}): string {
  return compile(code, { sourceMap: false, ...options }).code;
}

/**
 * Lowers JSX with Solid's own JSX transform, as a bundler plugin would after optimizing.
 */
export function lower(code: string, generate: 'dom' | 'ssr' = 'dom'): string {
  return transform(code, {
    filename: 'input.jsx',
    moduleName: '@solidjs/web',
    generate,
    hydratable: true,
  }).code;
}

/**
 * How many templates Solid's JSX transform creates for `code`.
 */
export function templateCount(code: string): number {
  return lower(code).match(/_\$template\(/g)?.length ?? 0;
}
