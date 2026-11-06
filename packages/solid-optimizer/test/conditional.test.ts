/**
 * `<Show>` and `<Switch>` lowering: the JSX it writes, and that each app renders the same
 * with and without it at every step.
 */
import { describe, expect, it } from 'vitest';
import { appCode, runBoth } from './harness';
import { compile } from '../src';
import { lower, optimize } from './utils';

function lowered(code: string): string {
  return optimize(code, { inline: false });
}

describe('the JSX it writes', () => {
  it('writes a ternary in an element', () => {
    expect(
      lowered(
        'import { Show } from "solid-js";\nconst view = (p) => <div><Show when={p.a} fallback={<b />}><i /></Show></div>;',
      ),
    ).toBe(
      'import { Show } from "solid-js";\nconst view = (p) => <div>{(p.a) ? <><i /></> : (<b />)}</div>;',
    );
  });

  it('wraps the ternary in a fragment outside an element', () => {
    expect(
      lowered(
        'import { Show } from "solid-js";\nfunction View(p) { return <Show when={p.a}><i /></Show>; }',
      ),
    ).toBe(
      'import { Show } from "solid-js";\nfunction View(p) { return <>{(p.a) ? <><i /></> : undefined}</>; }',
    );
  });

  it('wraps the sole child of a component in a fragment', () => {
    expect(
      lowered(
        'import { Show } from "solid-js";\nconst view = (p) => <Card>\n  <Show when={p.a}><i /></Show>\n</Card>;',
      ),
    ).toBe(
      'import { Show } from "solid-js";\nconst view = (p) => <Card>\n  <>{(p.a) ? <><i /></> : undefined}</>\n</Card>;',
    );
  });

  it('lowers a <Show> inside another', () => {
    const code = lowered(
      'import { Show } from "solid-js";\nconst view = (p) => <div><Show when={p.a}><i /><Show when={p.b}><b /></Show></Show></div>;',
    );
    expect(code).toBe(
      'import { Show } from "solid-js";\nconst view = (p) => <div>{(p.a) ? <><i />{(p.b) ? <><b /></> : undefined}</> : undefined}</div>;',
    );
    expect(lower(code)).not.toContain('createComponent');
  });

  it('compiles to one memo and no component, on the client and the server', () => {
    const jsx = lowered(
      'import { Show } from "solid-js";\nconst view = (p) => <div><Show when={p.a} fallback={<b />}><i /></Show></div>;',
    );
    const client = lower(jsx);
    expect(client).not.toContain('createComponent');
    expect(client.match(/_\$memo\(/g)).toHaveLength(1);
    expect(lower(jsx, 'ssr')).not.toContain('createComponent');
  });

  it.each([
    [
      'a callback whose when calls with arguments',
      '<div><Show when={p.find(1)}>{(a) => <i>{a()}</i>}</Show></div>',
    ],
    [
      'a callback with statements',
      '<div><Show when={p.a}>{(a) => { const b = a(); return <i>{b}</i>; }}</Show></div>',
    ],
    ['a callback without a parameter', '<div><Show when={p.a}>{() => <i />}</Show></div>'],
    [
      'a callback whose when calls a method',
      '<div><Show when={p.queue.shift()}>{(a) => <i>{a()}</i>}</Show></div>',
    ],
    [
      'a callback whose when calls a global',
      '<div><Show when={Math.random() > 0.5}>{(a) => <i>{a()}</i>}</Show></div>',
    ],
    [
      'a callback whose when reads this',
      '<div><Show when={this.user}>{(a) => <i onClick={function () { return a(); }} />}</Show></div>',
    ],
    [
      'a callback that writes its parameter',
      '<div><Show when={p.a}>{(a) => <i onClick={() => { a = null; }}>{a()}</i>}</Show></div>',
    ],
    [
      'a callback that uses its parameter as a tag',
      '<div><Show when={p.a}>{(C) => <C />}</Show></div>',
    ],
    [
      'a callback that shadows a name when reads',
      '<div><Show when={p.a}>{(a) => <For each={a()}>{(p) => <i>{a()}</i>}</For>}</Show></div>',
    ],
    [
      'a callback that reads its value by shorthand',
      '<div><Show when={p.a}>{(a) => <Card {...{ a }} />}</Show></div>',
    ],
    ['keyed', '<div><Show when={p.a} keyed><i /></Show></div>'],
    ['a spread', '<div><Show {...p}><i /></Show></div>'],
    ['a string fallback', '<div><Show when={p.a} fallback="&amp;"><i /></Show></div>'],
    ['a component with other children', '<Card><Show when={p.a}><i /></Show><b /></Card>'],
    ['an attribute', '<Card title={<Show when={p.a}><i /></Show>} />'],
    ['a JSX expression', '<div>{p.b && <Show when={p.a}><i /></Show>}</div>'],
    ['a child that could be a function', '<div><Show when={p.a}>{p.render}</Show></div>'],
    ['a function among other children', '<div><Show when={p.a}><b />{() => p.n}</Show></div>'],
    ['a repeated prop', '<div><Show when={p.a} when={p.b}><i /></Show></div>'],
  ])('keeps <Show> with %s', (_, jsx) => {
    const code = `import { Show } from "solid-js";\nconst view = (p) => ${jsx};`;
    expect(lowered(code)).toBe(code);
  });

  it('writes a callback child as its body, reading when again', () => {
    expect(
      lowered(
        'import { Show } from "solid-js";\nconst view = (p) => <div><Show when={p.user} fallback={<b />}>{(user) => <Avatar user={user()} name={user().name} get={user} />}</Show></div>;',
      ),
    ).toBe(
      'import { Show } from "solid-js";\nconst view = (p) => <div>{(p.user) ? <Avatar user={(p.user)} name={(p.user).name} get={(() => (p.user))} /> : (<b />)}</div>;',
    );
    expect(
      lowered(
        'import { Match, Switch } from "solid-js";\nconst view = (p) => <div><Switch><Match when={p.errors[p.id]}>{(message) => <p>{message()}</p>}</Match></Switch></div>;',
      ),
    ).toBe(
      'import { Match, Switch } from "solid-js";\nconst view = (p) => <div>{(p.errors[p.id]) ? <p>{(p.errors[p.id])}</p> : undefined}</div>;',
    );
  });

  it('reads a signal or a memo again, but not another call', () => {
    const imports = 'import { Show, createMemo, createSignal } from "solid-js";\n';
    expect(
      lowered(
        `${imports}const [user] = createSignal();\nconst issue = createMemo(() => 1);\nconst view = <div><Show when={user()}>{(u) => <i>{u()}</i>}</Show><Show when={issue()}>{(i) => <b>{i()}</b>}</Show></div>;`,
      ),
    ).toContain(
      '<div>{(user()) ? <i>{(user())}</i> : undefined}{(issue()) ? <b>{(issue())}</b> : undefined}</div>',
    );
    // An imported call, since the memo pass would inline a local arrow.
    const other = `${imports}import { load } from './load';\nconst view = <div><Show when={load()}>{(u) => <i>{u()}</i>}</Show></div>;`;
    expect(lowered(other)).toBe(other);
  });

  it('keeps a callback whose parameter a type names', () => {
    const code =
      'import { Show } from "solid-js";\nconst view = (p: { a?: string }) => <div><Show when={p.a}>{(v) => <i>{String(v() as ReturnType<typeof v>)}</i>}</Show></div>;';
    expect(optimize(code, { filename: 'view.tsx', inline: false })).toBe(code);
  });

  it('writes a container in a namespaced element', () => {
    expect(
      lowered(
        'import { Show } from "solid-js";\nconst view = (p) => <svg:g><Show when={p.a}><i /></Show></svg:g>;',
      ),
    ).toBe(
      'import { Show } from "solid-js";\nconst view = (p) => <svg:g>{(p.a) ? <><i /></> : undefined}</svg:g>;',
    );
  });

  it('lowers a value among other children, which <Show> gets as an array', () => {
    expect(
      lowered(
        'import { Show } from "solid-js";\nconst view = (p) => <div><Show when={p.a}>by {p.user}</Show></div>;',
      ),
    ).toBe(
      'import { Show } from "solid-js";\nconst view = (p) => <div>{(p.a) ? <>by {p.user}</> : undefined}</div>;',
    );
  });

  it('keeps children whose values are never functions', () => {
    expect(
      lowered(
        'import { Show } from "solid-js";\nconst view = (p) => <div><Show when={p.a}>{" "}{`n: ${p.n}`}{p.n + 1}</Show></div>;',
      ),
    ).toBe(
      'import { Show } from "solid-js";\nconst view = (p) => <div>{(p.a) ? <>{" "}{`n: ${p.n}`}{p.n + 1}</> : undefined}</div>;',
    );
  });

  it('lowers TypeScript and keeps a source map', () => {
    const result = compile(
      'import { Show } from "solid-js";\nconst view = (p: { a?: string }) => <div><Show when={p.a!}><i /></Show></div>;',
      { filename: 'view.tsx', inline: false },
    );
    expect(result.code).toContain('<div>{(p.a!) ? <><i /></> : undefined}</div>');
    expect(result.map?.sources).toEqual(['view.tsx']);
  });

  it('keeps a <Show> that is not Solid’s', () => {
    const code =
      'import { Show } from "./show";\nconst view = (p) => <div><Show when={p.a}><i /></Show></div>;';
    expect(lowered(code)).toBe(code);
  });

  it('can be turned off', () => {
    const code =
      'import { Show } from "solid-js";\nconst view = (p) => <div><Show when={p.a}><i /></Show></div>;';
    expect(optimize(code, { conditionals: false })).toBe(code);
  });
});

const SWITCH = 'import { Match, Switch } from "solid-js";\n';

describe('<Switch>', () => {
  it('writes a chain of ternaries', () => {
    expect(
      lowered(
        `${SWITCH}const view = (p) => <div><Switch fallback={<u />}><Match when={p.a}><i /></Match><Match when={p.b}>b</Match></Switch></div>;`,
      ),
    ).toBe(
      `${SWITCH}const view = (p) => <div>{(p.a) ? <><i /></> : (p.b) ? <>b</> : (<u />)}</div>;`,
    );
  });

  it('wraps the chain in a fragment outside an element', () => {
    expect(
      lowered(
        `${SWITCH}function View(p) { return <Switch><Match when={p.a}><i /></Match></Switch>; }`,
      ),
    ).toBe(`${SWITCH}function View(p) { return <>{(p.a) ? <><i /></> : undefined}</>; }`);
  });

  it('compiles to memos and no component, on the client and the server', () => {
    const jsx = lowered(
      `${SWITCH}const view = (p) => <div><Switch fallback={<u />}><Match when={p.a}><i /></Match><Match when={p.b}><b /></Match></Switch></div>;`,
    );
    expect(lower(jsx)).not.toContain('createComponent');
    expect(lower(jsx, 'ssr')).not.toContain('createComponent');
  });

  it.each([
    [
      'a callback whose when calls with arguments',
      '<div><Switch><Match when={p.find(1)}>{(a) => <i>{a()}</i>}</Match></Switch></div>',
    ],
    ['a keyed <Match>', '<div><Switch><Match when={p.a} keyed><i /></Match></Switch></div>'],
    [
      'a child that is not a <Match>',
      '<div><Switch><Match when={p.a}><i /></Match>{p.b}</Switch></div>',
    ],
    [
      'a prop other than fallback',
      '<div><Switch name="x"><Match when={p.a}><i /></Match></Switch></div>',
    ],
  ])('keeps <Switch> with %s', (_, jsx) => {
    const code = `${SWITCH}const view = (p) => ${jsx};`;
    expect(lowered(code)).toBe(code);
  });
});

function app(body: string): Record<string, string> {
  return {
    'main.tsx': `import { render } from '@solidjs/web';
import { For, Match, Show, Switch, createSignal } from 'solid-js';
${body}
render(() => <App />, document.getElementById('app')!);
`,
  };
}

async function expectSameBehavior(
  name: string,
  files: Record<string, string>,
  clicks: readonly string[],
): Promise<string> {
  const { optimized, plain } = await runBoth(name, files, clicks);
  expect(optimized.snapshots).toEqual(plain.snapshots);
  // The clicks have to change something, or the comparison proves nothing.
  expect(new Set(plain.snapshots).size).toBeGreaterThan(1);
  return appCode(optimized.code);
}

describe('behavior', () => {
  it('switches between the children and the fallback', async () => {
    const code = await expectSameBehavior(
      'show-toggle',
      app(`function App() {
  const [on, setOn] = createSignal(false);
  return (
    <main>
      <button onClick={() => setOn(!on())}>toggle</button>
      <Show when={on()} fallback={<p>off</p>}>
        <p>on</p>
      </Show>
    </main>
  );
}`),
      ['button', 'button', 'button'],
    );
    expect(code).not.toMatch(/createComponent\(Show/);
  });

  it('keeps the children while the condition stays truthy', async () => {
    // The counter inside would reset if the children were made again.
    const code = await expectSameBehavior(
      'show-truthy',
      app(`function Counter() {
  const [count, setCount] = createSignal(0);
  return <button id="inner" onClick={() => setCount(count() + 1)}>{count()}</button>;
}
function App() {
  const [n, setN] = createSignal(1);
  return (
    <main>
      <button id="outer" onClick={() => setN(n() + 1)}>{n()}</button>
      <Show when={n()}>
        <Counter />
      </Show>
    </main>
  );
}`),
      ['#inner', '#inner', '#outer', '#outer'],
    );
    expect(code).not.toMatch(/createComponent\(Show/);
  });

  it('works as the root a component returns', async () => {
    const code = await expectSameBehavior(
      'show-root',
      app(`function Panel(props) {
  return (
    <Show when={props.open} fallback={<p>closed</p>}>
      <p>open</p>
    </Show>
  );
}
function App() {
  const [open, setOpen] = createSignal(false);
  return (
    <main>
      <button onClick={() => setOpen(!open())}>toggle</button>
      <Panel open={open()} />
    </main>
  );
}`),
      ['button', 'button'],
    );
    expect(code).not.toMatch(/createComponent\(Show/);
  });

  it('works nested, in a <For> row, and as a component’s child', async () => {
    const code = await expectSameBehavior(
      'show-nested',
      app(`function Card(props) {
  return <section>{props.children}</section>;
}
function App() {
  const [items, setItems] = createSignal([{ id: 1, more: true }, { id: 2, more: false }]);
  const [open, setOpen] = createSignal(true);
  return (
    <main>
      <button id="open" onClick={() => setOpen(!open())}>open</button>
      <button id="flip" onClick={() => setItems(items().map((item) => ({ ...item, more: !item.more })))}>flip</button>
      <ul>
        <For each={items()}>
          {(item) => (
            <Show when={item.more} fallback={<li>{item.id}</li>}>
              <li>
                {item.id}
                <Show when={open()}>
                  <b>more</b>
                </Show>
              </li>
            </Show>
          )}
        </For>
      </ul>
      <Card>
        <Show when={open()}>
          <i>card</i>
        </Show>
      </Card>
    </main>
  );
}`),
      ['#open', '#flip', '#open', '#flip'],
    );
    expect(code).not.toMatch(/createComponent\(Show/);
  });

  it('renders the first <Match> that holds, and keeps it while it does', async () => {
    // The counter inside would reset if the branch were made again.
    const code = await expectSameBehavior(
      'switch-chain',
      app(`function Counter() {
  const [count, setCount] = createSignal(0);
  return <button id="inner" onClick={() => setCount(count() + 1)}>{count()}</button>;
}
function App() {
  const [n, setN] = createSignal(0);
  return (
    <main>
      <button id="next" onClick={() => setN((n() + 1) % 4)}>{n()}</button>
      <Switch fallback={<p>none</p>}>
        <Match when={n() > 0 && n() < 3}>
          <Counter />
        </Match>
        <Match when={n() > 0}>
          <p>three</p>
        </Match>
      </Switch>
    </main>
  );
}`),
      ['#next', '#inner', '#next', '#inner', '#next', '#next', '#next'],
    );
    expect(code).not.toMatch(/createComponent\((Switch|Match)/);
  });

  it('passes a callback the value, and keeps its children while it stays truthy', async () => {
    // The counter inside would reset if the callback ran again.
    const code = await expectSameBehavior(
      'show-callback',
      app(`function Counter() {
  const [count, setCount] = createSignal(0);
  return <button id="inner" onClick={() => setCount(count() + 1)}>{count()}</button>;
}
function App() {
  const [user, setUser] = createSignal<{ name: string } | undefined>(undefined);
  const names = ['Ana', 'Ben'];
  let next = 0;
  return (
    <main>
      <button id="next" onClick={() => setUser(next < 2 ? { name: names[next++] } : ((next = 0), undefined))}>
        next
      </button>
      <Show when={user()} fallback={<p>nobody</p>}>
        {(current) => (
          <p>
            {current().name} <Counter />
          </p>
        )}
      </Show>
    </main>
  );
}`),
      ['#next', '#inner', '#next', '#inner', '#next', '#next'],
    );
    expect(code).not.toMatch(/createComponent\(Show/);
  });
});
