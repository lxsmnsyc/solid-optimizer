import { transformSync } from '@babel/core';
import solid from 'babel-preset-solid';
import type { CompileOptions } from '../src';
import { compile } from '../src';

/**
 * Optimizes JSX and returns the JSX that comes out.
 */
export function optimize(code: string, options: CompileOptions = {}): string {
  return compile(code, { sourceMap: false, ...options }).code;
}

/**
 * Lowers JSX with Solid's JSX transform, as a bundler plugin would after optimizing.
 */
export function lower(code: string, generate: 'dom' | 'ssr' = 'dom'): string {
  const result = transformSync(code, {
    filename: 'input.jsx',
    presets: [[solid, { generate, hydratable: true }]],
    configFile: false,
    babelrc: false,
  });
  return result?.code ?? '';
}

/**
 * How many templates Solid's JSX transform creates for `code`.
 */
export function templateCount(code: string): number {
  return lower(code).match(/_\$template\(/g)?.length ?? 0;
}
