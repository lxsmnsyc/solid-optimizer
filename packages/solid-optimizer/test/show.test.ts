/**
 * `<Show>` lowering: the JSX it writes, and that each app renders the same
 * with and without it at every step.
 */
import { describe, expect, it } from 'vitest';
import { appCode, runBoth } from './harness';
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
    ['a callback child', '<div><Show when={p.a}>{(a) => <i>{a()}</i>}</Show></div>'],
    ['keyed', '<div><Show when={p.a} keyed><i /></Show></div>'],
    ['a spread', '<div><Show {...p}><i /></Show></div>'],
    ['a string fallback', '<div><Show when={p.a} fallback="&amp;"><i /></Show></div>'],
    ['a component with other children', '<Card><Show when={p.a}><i /></Show><b /></Card>'],
    ['an attribute', '<Card title={<Show when={p.a}><i /></Show>} />'],
    ['a JSX expression', '<div>{p.b && <Show when={p.a}><i /></Show>}</div>'],
  ])('keeps <Show> with %s', (_, jsx) => {
    const code = `import { Show } from "solid-js";\nconst view = (p) => ${jsx};`;
    expect(lowered(code)).toBe(code);
  });

  it('keeps a <Show> that is not Solid’s', () => {
    const code =
      'import { Show } from "./show";\nconst view = (p) => <div><Show when={p.a}><i /></Show></div>;';
    expect(lowered(code)).toBe(code);
  });

  it('can be turned off', () => {
    const code =
      'import { Show } from "solid-js";\nconst view = (p) => <div><Show when={p.a}><i /></Show></div>;';
    expect(optimize(code, { shows: false })).toBe(code);
  });
});

function app(body: string): Record<string, string> {
  return {
    'main.tsx': `import { render } from '@solidjs/web';
import { For, Show, createSignal } from 'solid-js';
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
});
