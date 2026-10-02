import { describe, expect, it } from 'vitest';
import { addMarker, repairJSXSequences } from '../src/vite/runtime';

describe('addMarker', () => {
  it('keeps only the built-ins the module still uses', () => {
    const code = `import { Dynamic } from "solid-js/web";
import { For, Show } from "solid-js";
export const list = <For each={[]}>{() => <p />}</For>;
`;
    const marked = addMarker(code, 'a.tsx', {
      moduleName: 'solid-js/web',
      helpers: new Set(['template']),
      moduleSources: ['solid-js', 'solid-js/web'],
      builtIns: new Set(['Dynamic', 'For', 'Show']),
    });
    // A folded `<Show>` or `<Dynamic>` leaves an unused import, which the bundler drops.
    expect(marked?.code).toContain('"builtin:For": For');
    expect(marked?.code).not.toContain('builtin:Show');
    expect(marked?.code).not.toContain('builtin:Dynamic');
  });
});

describe('repairJSXSequences', () => {
  it('wraps comma expressions in JSX expression containers', () => {
    const code = 'const a = <p title={b(), 1}>{c(), d}{(e, f)}{[g, h]}</p>;';
    expect(repairJSXSequences(code, 'a.js')?.code).toBe(
      'const a = <p title={(b(), 1)}>{(c(), d)}{(e, f)}{[g, h]}</p>;',
    );
  });

  it('returns nothing when no container has one', () => {
    expect(repairJSXSequences('const a = <p>{(b, c)}</p>;', 'a.js')).toBeUndefined();
  });
});
