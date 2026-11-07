/**
 * A `<Show>` in another `<Show>`'s `fallback` can resolve first, in the same
 * round, to an expression. The outer one has to splice that expression, not
 * its text as JSX.
 */
import { describe, expect, it } from 'vitest';
import { optimize } from './utils';

function lastLine(code: string): string {
  return optimize(code).split('\n').at(-1) ?? '';
}

describe('a fallback that a fold already resolved', () => {
  it('splices a string fallback as a string', () => {
    expect(
      lastLine(
        'import { Show } from \'solid-js\';\nexport const v = <span><Show when={false} fallback={<Show when={false} fallback="a" />} /></span>;',
      ),
    ).toBe('export const v = <span>{"a"}</span>;');
  });

  it('splices an expression fallback as an expression', () => {
    expect(
      lastLine(
        "import { Show } from 'solid-js';\nexport function V(props) { return <span><Show when={false} fallback={<Show when={false} fallback={props.label} />} /></span>; }",
      ),
    ).toBe('export function V(props) { return <span>{(props.label)}</span>; }');
  });

  it('splices a resolved JSX fallback as JSX', () => {
    expect(
      lastLine(
        "import { Show } from 'solid-js';\nexport const v = <span><Show when={false} fallback={<Show when={false} fallback={<b>a</b>} />} /></span>;",
      ),
    ).toBe('export const v = <span><b>a</b></span>;');
  });
});
