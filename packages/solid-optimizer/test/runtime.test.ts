import { describe, expect, it } from 'vitest';
import { generatedImports } from '../src/vite/runtime';

describe('generatedImports', () => {
  it('lists only the helpers the JSX transform added', () => {
    const code = `import type { JSX } from "solid-js/web";
import { render } from "solid-js/web";
import { template as _$template } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { createSignal } from "solid-js";
`;
    expect(generatedImports(code, 'a.tsx', 'solid-js/web')).toEqual(['template', 'insert']);
  });
});
