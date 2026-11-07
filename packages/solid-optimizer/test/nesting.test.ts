/**
 * The passes can put an element straight inside a parent that cannot hold
 * it. Solid's JSX transform rejects that template, so the element is kept
 * apart, inserted at runtime as it was before the pass.
 */
import { describe, expect, it } from 'vitest';
import { lower, optimize } from './utils';

function lowersOptimized(code: string): string {
  const optimized = optimize(code);
  expect(() => lower(optimized)).not.toThrow();
  return optimized;
}

describe('invalid nesting', () => {
  it('keeps an inlined block element apart from a <p>', () => {
    expect(
      lowersOptimized(
        'function Box() { return <div>box</div>; }\nexport const view = <p>hi <Box /></p>;',
      ),
    ).toContain('<p>hi {<div>box</div>}</p>');
  });

  it('keeps an <li> apart from an inlined <li>', () => {
    expect(
      lowersOptimized(
        'function Row(props) { return <li>{props.children}</li>; }\nexport const view = <ul><Row><Row>x</Row></Row></ul>;',
      ),
    ).toContain('<ul><li>{<li>x</li>}</li></ul>');
  });

  it('keeps an inlined <td> apart from a <div>', () => {
    lowersOptimized(
      'function Cell() { return <td>c</td>; }\nexport const view = <div><Cell /></div>;',
    );
  });

  it('keeps a resolved <Show> branch apart', () => {
    expect(
      lowersOptimized(
        "import { Show } from 'solid-js';\nexport const view = <p><Show when={true}><div>a</div></Show></p>;",
      ),
    ).toContain('<p>{<div>a</div>}</p>');
  });

  it('keeps unrolled <For> rows apart', () => {
    expect(
      lowersOptimized(
        "import { For } from 'solid-js';\nexport const view = <p><For each={[1, 2]}>{(x) => <div>{x}</div>}</For></p>;",
      ),
    ).toContain('<p>{<div>{1}</div>}{<div>{2}</div>}</p>');
  });

  it('keeps a resolved <Dynamic> apart', () => {
    lowersOptimized(
      'import { Dynamic } from \'@solidjs/web\';\nexport const view = <p><Dynamic component="div">a</Dynamic></p>;',
    );
  });

  it('looks through a fragment', () => {
    expect(
      lowersOptimized(
        'function Box() { return <><div>a</div><b>b</b></>; }\nexport const view = <p><Box /></p>;',
      ),
    ).toContain('{<div>a</div>}<b>b</b>');
  });

  it('keeps a block element apart from a <p> it is not directly in', () => {
    expect(
      lowersOptimized(
        'function Box() { return <div>box</div>; }\nexport const view = <p><span><Box /></span></p>;',
      ),
    ).toContain('<p><span>{<div>box</div>}</span></p>');
  });

  it('keeps a link apart from a link around it', () => {
    lowersOptimized(
      'function Link() { return <a href="/">home</a>; }\nexport const view = <a href="/x"><b><Link /></b></a>;',
    );
  });

  it('keeps an inlined row apart from a table without a body', () => {
    lowersOptimized(
      'function Row() { return <tr><td>c</td></tr>; }\nexport const view = <table><Row /></table>;',
    );
  });

  it('keeps HTML apart from an SVG group', () => {
    expect(
      lowersOptimized(
        'function Label() { return <span>a</span>; }\nfunction Group() { return <g><Label /></g>; }\nexport const view = <svg><Group /></svg>;',
      ),
    ).toContain('<svg><g>{<span>a</span>}</g></svg>');
  });

  it('keeps an element apart from a <template>', () => {
    lowersOptimized(
      'function Box() { return <div>a</div>; }\nexport const view = <template><Box /></template>;',
    );
  });

  it('keeps SVG inside <foreignObject> HTML in one template', () => {
    expect(
      optimize(
        'function Box() { return <div>a</div>; }\nexport const view = <svg><foreignObject><Box /></foreignObject></svg>;',
      ),
    ).toContain('<foreignObject><div>a</div></foreignObject>');
  });

  it('leaves valid nesting in one template', () => {
    expect(
      optimize('function Bold() { return <b>bold</b>; }\nexport const view = <p>a <Bold /></p>;'),
    ).toContain('<p>a <b>bold</b></p>');
  });

  it('leaves a module the passes did not change as written', () => {
    const code = 'export const view = <p><div>a</div></p>;';
    expect(optimize(code)).toBe(code);
  });
});
