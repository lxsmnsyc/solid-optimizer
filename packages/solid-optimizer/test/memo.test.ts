import { describe, expect, it } from 'vitest';
import { optimize } from './utils';

function memos(code: string): string {
  return optimize(code, { fold: false, inline: false });
}

function component(
  body: string,
  jsx: string,
  imports = "import { createMemo } from 'solid-js';",
): string {
  return `${imports}
export function View() {
  ${body}
  return ${jsx};
}
`;
}

describe('memo inlining', () => {
  it('inlines a memo that returns a new object and is read once', () => {
    const output = memos(
      component('const style = createMemo(() => ({ color: color() }));', '<p style={style()} />'),
    );
    expect(output).not.toContain('createMemo(');
    expect(output).toContain('return <p style={({ color: color() })} />;');
  });

  it('inlines memos of arrays, functions, and JSX', () => {
    for (const value of [
      '[a(), b()]',
      '() => a()',
      '<b>{a()}</b>',
      'new Set(a())',
      'a() ? [1] : [2]',
    ]) {
      const output = memos(component(`const v = createMemo(() => ${value});`, '<div>{v()}</div>'));
      expect(output).not.toContain('createMemo(');
      expect(output).toContain(`<div>{${value}}</div>`);
    }
  });

  it('inlines a memo with equals: false', () => {
    const output = memos(
      component(
        'const total = createMemo(() => a() + b(), { equals: false });',
        '<span>{total()}</span>',
      ),
    );
    expect(output).toContain('<span>{a() + b()}</span>');
  });

  it('inlines a block body that only returns', () => {
    const output = memos(
      component(
        'const list = createMemo(() => {\n    return items().slice(0, 3);\n  }, { equals: false });',
        '<ul>{list()}</ul>',
      ),
    );
    expect(output).toContain('<ul>{items().slice(0, 3)}</ul>');
  });

  it('inlines a computation with its own callbacks', () => {
    const output = memos(
      component(
        'const rows = createMemo(() => [...items().map((item, index) => ({ item, index }))]);',
        '<ul>{rows()}</ul>',
      ),
    );
    expect(output).toContain('<ul>{[...items().map((item, index) => ({ item, index }))]}</ul>');
  });

  it('inlines a tracked prop of a built-in component', () => {
    const output = memos(
      component(
        'const rows = createMemo(() => [...items()]);',
        '<ul><For each={rows()}>{(row) => <li>{row}</li>}</For></ul>',
        "import { createMemo, For } from 'solid-js';",
      ),
    );
    expect(output).toContain('<For each={[...items()]}>');
  });

  it('inlines through a renamed import', () => {
    const output = memos(
      component(
        'const v = createMemo(() => [a()]);',
        '<i>{v()}</i>',
        "import { createMemo as memo } from 'solid-js';",
      ).replace('createMemo(', 'memo('),
    );
    expect(output).toContain('<i>{[a()]}</i>');
  });

  it('keeps memos that do something', () => {
    const cases = [
      // A value that can equal the last one stops updates.
      component('const v = createMemo(() => a() * 2);', '<i>{v()}</i>'),
      // Read twice: the memo computes once for both.
      component('const v = createMemo(() => [a()]);', '<i>{v()}{v()}</i>'),
      // Read in an event handler: the handler sees the cached value.
      component('const v = createMemo(() => [a()]);', '<button onClick={() => log(v())} />'),
      // Read per item: every row shares one memo.
      component(
        'const v = createMemo(() => [a()]);',
        '<ul><For each={items()}>{() => <li>{v()}</li>}</For></ul>',
        "import { createMemo, For } from 'solid-js';",
      ),
      // Read in a component's children, which can render more than once.
      component('const v = createMemo(() => [a()]);', '<Card>{v()}</Card>'),
      // Read in a component's prop, which the component can read any number of times.
      component('const v = createMemo(() => [a()]);', '<Card items={v()} />'),
      // Part of a larger expression, which has its own dependencies.
      component('const v = createMemo(() => [a()]);', '<i>{format(v(), b())}</i>'),
      // Uses the previous value.
      component('const v = createMemo((prev) => [a(), prev]);', '<i>{v()}</i>'),
      // Async.
      component('const v = createMemo(async () => [await a()]);', '<i>{v()}</i>'),
      // Other options.
      component("const v = createMemo(() => [a()], { name: 'v' });", '<i>{v()}</i>'),
      // Escapes.
      component('const v = createMemo(() => [a()]);\n  use(v);', '<i>{v()}</i>'),
      // Not Solid's createMemo.
      component(
        'const v = createMemo(() => [a()]);',
        '<i>{v()}</i>',
        "import { createMemo } from './memo';",
      ),
      // A name in the computation means something else at the read.
      component(
        'const v = createMemo(() => [a()]);',
        '<ul><For each={items()}>{(a) => <li>{v()}</li>}</For></ul>',
        "import { createMemo, For } from 'solid-js';",
      ),
    ];
    for (const code of cases) {
      expect(memos(code)).toBe(code);
    }
  });

  it('keeps a memo outside any function', () => {
    const code =
      "import { createMemo } from 'solid-js';\nconst v = createMemo(() => [a()]);\nexport const view = <i>{v()}</i>;\n";
    expect(memos(code)).toBe(code);
  });
});
