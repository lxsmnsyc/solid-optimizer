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

  it('replaces every read of a memo whose computation is a literal', () => {
    const output = memos(
      component(
        "const size = createMemo(() => 3);\n  const label = createMemo(() => 'big');\n  const offset = createMemo(() => -1);",
        '<p title={label()} onClick={() => log(size())}>{size() * 2}{size().toFixed(1)}{offset() ** 2}</p>',
      ),
    );
    expect(output).not.toContain('createMemo(() =>');
    expect(output).toContain(
      "return <p title={'big'} onClick={() => log(3)}>{(3) * 2}{(3).toFixed(1)}{(-1) ** 2}</p>;",
    );
  });

  it('folds what a constant memo leaves behind', () => {
    const output = optimize(
      component('const size = createMemo(() => 1 + 2);', '<p>{size() * 2}</p>'),
    );
    expect(output).toContain('return <p>{6}</p>;');
  });

  it('keeps a constant memo that is not only called after it is declared', () => {
    const cases = [
      component('const size = createMemo(() => 3);\n  use(size);', '<p>{size()}</p>'),
      component(
        'function read() {\n    return size();\n  }\n  const size = createMemo(() => 3);',
        '<p>{read()}</p>',
      ),
    ];
    for (const code of cases) {
      expect(memos(code)).toBe(code);
    }
  });

  it('inlines the children helper over JSX read once as a child', () => {
    const output = memos(
      component(
        'const c = children(() => <b>{name()}</b>);',
        '<div>{c()}</div>',
        "import { children } from 'solid-js';",
      ),
    );
    expect(output).not.toContain('children(');
    expect(output).toContain('return <div><b>{name()}</b></div>;');
  });

  it('keeps the children helper when it does more than resolve JSX once', () => {
    const imports = "import { children } from 'solid-js';";
    const cases = [
      // Children that are not JSX can be functions or arrays the helper resolves in its memo.
      component('const c = children(() => props.children);', '<div>{c()}</div>', imports),
      // Read twice, which shares one set of nodes.
      component('const c = children(() => <b />);', '<div>{c()}{c()}</div>', imports),
      // Read as an attribute, or through its array.
      component('const c = children(() => <b />);', '<div title={c()} />', imports),
      component('const c = children(() => <b />);', '<div>{c.toArray()}</div>', imports),
      // Read in a component's children, which can read it any number of times.
      component('const c = children(() => <b />);', '<Box>{c()}</Box>', imports),
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

describe('signals that are never written', () => {
  const imports = "import { createSignal } from 'solid-js';";

  it('replaces every read of a signal with no setter', () => {
    const output = memos(
      component(
        "const [size] = createSignal(3);\n  const [label, setLabel] = createSignal('big');\n  const [offset] = createSignal(-1);\n  const [unit] = createSignal(`px`);",
        '<p title={label()} onClick={() => log(size())}>{size() * 2}{offset()}{unit()}</p>',
        imports,
      ),
    );
    expect(output).not.toContain('createSignal(');
    expect(output).toContain(
      "return <p title={'big'} onClick={() => log(3)}>{(3) * 2}{-1}{`px`}</p>;",
    );
  });

  it('replaces reads of a signal at module scope', () => {
    const output = memos(`${imports}
const [theme] = createSignal('dark');
export const View = () => <main class={theme()} />;
`);
    expect(output).toBe(`${imports}

export const View = () => <main class={'dark'} />;
`);
  });

  it('folds what a constant signal leaves behind', () => {
    const output = optimize(
      component('const [size] = createSignal(1);', '<p>{size() + 1}</p>', imports),
    );
    expect(output).toContain('return <p>{2}</p>;');
  });

  it('keeps a signal that can change or that is read another way', () => {
    const cases = [
      // Written.
      component(
        'const [size, setSize] = createSignal(3);\n  setSize(4);',
        '<p>{size()}</p>',
        imports,
      ),
      // Not a literal, or given options.
      component('const [size] = createSignal(initial);', '<p>{size()}</p>', imports),
      component('const [size] = createSignal(undefined);', '<p>{size()}</p>', imports),
      component('const [size] = createSignal({ n: 1 });', '<p>{size().n}</p>', imports),
      component(
        "const [size] = createSignal(3, { unobserved: () => log('gone') });",
        '<p>{size()}</p>',
        imports,
      ),
      // The getter passed as a value.
      component('const [size] = createSignal(3);\n  use(size);', '<p>{size()}</p>', imports),
      // Not destructured, or with more than a getter and a setter.
      component('const size = createSignal(3);', '<p>{size[0]()}</p>', imports),
      component('const [size, , extra] = createSignal(3);', '<p>{size()}</p>', imports),
      // Exported, so other modules can read it.
      `${imports}\nexport const [size] = createSignal(3);\nexport const View = () => <p>{size()}</p>;\n`,
      // Not Solid's.
      component(
        'const [size] = createSignal(3);',
        '<p>{size()}</p>',
        "import { createSignal } from './signals';",
      ),
    ];
    for (const code of cases) {
      expect(memos(code)).toBe(code);
    }
  });
});

describe('derived arrows', () => {
  it('replaces the call of an arrow called once', () => {
    const output = memos(
      component(
        "const label = () => (props.open ? 'Close' : 'Open');",
        '<button>{label()}</button>',
      ),
    );
    expect(output).toContain("return <button>{(props.open ? 'Close' : 'Open')}</button>;");
    expect(output).not.toContain('const label');
  });

  it('wraps a body that is not primary outside a JSX container', () => {
    const output = memos(
      component('const total = () => a() + b();', '<p onClick={() => log(total() * 2)} />'),
    );
    expect(output).toContain('return <p onClick={() => log((a() + b()) * 2)} />;');
  });

  it('copies a short body to every call', () => {
    const output = memos(`const label = () => 'x';
export const View = () => <p title={label()}>{label()}{label()}</p>;
`);
    expect(output).toBe(`
export const View = () => <p title={'x'}>{'x'}{'x'}</p>;
`);
  });

  it('inlines arrows that call each other, in either order', () => {
    for (const order of [
      'const b = () => props.x;\n  const a = () => b() + 1;',
      'const a = () => b() + 1;\n  const b = () => props.x;',
    ]) {
      const output = memos(component(order, '<p>{a()}</p>'));
      expect(output).toContain('return <p>{(props.x) + 1}</p>;');
    }
  });

  it('copies a body that reads a constant signal after the signal is replaced', () => {
    const output = memos(
      component(
        'const [size] = createSignal(3);\n  const big = () => size() > props.limit;',
        '<p>{big()}</p>',
        "import { createSignal } from 'solid-js';",
      ),
    );
    expect(output).toContain('return <p>{(3) > props.limit}</p>;');
  });

  it('keeps an arrow that is more than a derivation', () => {
    const cases = [
      // Used as a value, like a handler.
      component('const go = () => props.onGo();', '<button onClick={go}>{go()}</button>'),
      // Long, and called more than once.
      component(
        "const label = () => (props.open ? 'Close' : 'Open');",
        '<button title={label()}>{label()}</button>',
      ),
      // Takes a parameter, is async, or is called with arguments or optionally.
      component('const twice = (n) => n * 2;', '<p>{twice(2)}</p>'),
      component('const load = async () => fetch(url);', '<p>{load()}</p>'),
      component('const read = () => value;', '<p>{read(1)}{read?.()}</p>'),
      // A name that means something else at the call, and `this`.
      component(
        'const v = () => a();',
        '<ul><For each={items()}>{(a) => <li>{v()}</li>}</For></ul>',
        "import { For } from 'solid-js';",
      ),
      `export const view = {\n  label() {\n    const self = () => this.name;\n    return function () {\n      return self();\n    };\n  },\n};\n`,
      // Called before its declaration, which throws.
      component('const early = read();\n  const read = () => 1;', '<p>{early}</p>'),
      // The result called, tagged, or deleted, where `(a.b)` passes or deletes `a`'s property.
      component('const l = () => a.b;', '<p>{l()()}{l()`x`}{String(delete l())}</p>'),
      // Exported.
      `export const label = () => 'x';\nexport const View = () => <p>{label()}</p>;\n`,
    ];
    for (const code of cases) {
      expect(memos(code)).toBe(code);
    }
  });
});
