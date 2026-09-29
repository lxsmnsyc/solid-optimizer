import { describe, expect, it } from 'vitest';
import { generatedImports } from '../src/vite/runtime';

describe('generatedImports', () => {
  it('lists only the helpers the JSX transform added', () => {
    const code = `import type { JSX } from "@solidjs/web";
import { render } from "@solidjs/web";
import { template as _$template } from "@solidjs/web";
import { insert as _$insert } from "@solidjs/web";
import { createSignal } from "solid-js";
`;
    expect(generatedImports(code, 'a.tsx', '@solidjs/web')).toEqual(['template', 'insert']);
  });
});
