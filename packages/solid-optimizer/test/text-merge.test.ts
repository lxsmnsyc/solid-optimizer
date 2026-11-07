/**
 * A fold inside a spliced child can turn its first or last child into text
 * in the same round. That text still must not merge with the text beside it.
 */
import { describe, expect, it } from 'vitest';
import { optimize } from './utils';

function lastLine(code: string): string {
  return optimize(code).split('\n').slice(1).join('\n');
}

describe('texts beside a nested fold', () => {
  it('keeps nested fragments apart from the next text', () => {
    expect(lastLine('\nexport const v = <span><><>a</></>\n  x\n  </span>;')).toBe(
      'export const v = <span>a{}\n  x\n  </span>;',
    );
  });

  it('keeps a <Show> resolved inside a fallback apart from the next text', () => {
    expect(
      lastLine(
        "import { Show } from 'solid-js';\nexport const v = <span><Show when={false} fallback={<><Show when={false} fallback={<>a</>}></Show></>}></Show>\n  x\n  </span>;",
      ),
    ).toBe('export const v = <span>a{}\n  x\n  </span>;');
  });

  it('keeps a <Show> resolved inside a <Show> apart from the next text', () => {
    expect(
      lastLine(
        "import { Show } from 'solid-js';\nexport const v = <span><Show when={true}><Show when={true}>a</Show></Show>\n  x\n  </span>;",
      ),
    ).toBe('export const v = <span>a{}\n  x\n  </span>;');
  });

  it('keeps a text before a nested fold apart', () => {
    expect(
      lastLine(
        "import { Show } from 'solid-js';\nexport const v = <span>\n  x\n  <Show when={true}><Show when={true}>a</Show></Show></span>;",
      ),
    ).toBe('export const v = <span>\n  x\n  {}a</span>;');
  });

  it('lets two dropped texts meet', () => {
    expect(
      lastLine(
        "import { Show } from 'solid-js';\nexport const v = <span><b /><Show when={true}>\n  <b />\n  </Show>\n  </span>;",
      ),
    ).not.toContain('{}');
  });
});
