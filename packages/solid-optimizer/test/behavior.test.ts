/**
 * Runtime behavior: each app is built with and without the optimizer, run in
 * a DOM, and must render the same thing at every step.
 */
import { describe, expect, it } from 'vitest';
import { appCode, runBoth } from './harness';

function app(
  body: string,
  imports = "import { createSignal } from 'solid-js';",
): Record<string, string> {
  return {
    'main.tsx': `import { render } from 'solid-js/web';
${imports}
${body}
render(() => <App />, document.getElementById('app')!);
`,
  };
}

async function expectSameBehavior(
  name: string,
  files: Record<string, string>,
  clicks: readonly string[] = [],
): Promise<string> {
  const { optimized, plain } = await runBoth(name, files, clicks);
  expect(optimized.snapshots).toEqual(plain.snapshots);
  if (clicks.length > 0) {
    // The clicks have to change something, or the comparison proves nothing.
    expect(new Set(plain.snapshots).size).toBeGreaterThan(1);
  }
  return appCode(optimized.code);
}

describe('context', () => {
  it('reads a default value and a provided value', async () => {
    const code = await expectSameBehavior(
      'context-default',
      app(
        `const Theme = createContext('light');
function Label() {
  const theme = useContext(Theme);
  return <span>{theme}</span>;
}
function App() {
  return (
    <main>
      <Label />
      <Theme.Provider value="dark">
        <div><Label /></div>
      </Theme.Provider>
    </main>
  );
}`,
        "import { createContext, useContext } from 'solid-js';",
      ),
    );
    // The consumer outside the provider reads the default. The one inside
    // moves out with the provider's value, and the provider is removed.
    expect(code).toContain('const theme$1 = useContext(Theme);');
    expect(code).not.toContain('createComponent(Label');
    expect(code).not.toContain('createComponent(Theme');
  });

  it('keeps a consumer under an inlined provider', async () => {
    const code = await expectSameBehavior(
      'context-provider',
      app(
        `const Theme = createContext('light');
function ThemeProvider(props) {
  return <Theme.Provider value={props.theme}>{props.children}</Theme.Provider>;
}
function Label() {
  const theme = useContext(Theme);
  return <span>{theme}</span>;
}
function App() {
  return (
    <main>
      <ThemeProvider theme="dark">
        <p><Label /></p>
      </ThemeProvider>
      <Label />
    </main>
  );
}`,
        "import { createContext, useContext } from 'solid-js';",
      ),
    );
    expect(code).not.toContain('ThemeProvider');
    expect(code).not.toContain('createComponent(Theme');
  });

  it('reads context inside inlined JSX', async () => {
    const code = await expectSameBehavior(
      'context-jsx',
      app(
        `const Theme = createContext('light');
const Label = () => <span>{useContext(Theme)}</span>;
function App() {
  return (
    <main>
      <Label />
      <Theme.Provider value="dark"><Label /></Theme.Provider>
      <Theme.Provider value="blue"><Theme.Provider value="red"><Label /></Theme.Provider></Theme.Provider>
    </main>
  );
}`,
        "import { createContext, useContext } from 'solid-js';",
      ),
    );
    // JSX-only consumers inline everywhere, and then each provider is removed.
    expect(code).not.toContain('Label');
    expect(code).not.toContain('createComponent(Theme');
  });

  it('follows a provider whose value changes', async () => {
    const code = await expectSameBehavior(
      'context-reactive',
      app(
        `const Count = createContext(() => 0);
function Display() {
  const count = useContext(Count);
  return <output>{count()}</output>;
}
function Panel() {
  return <section><Display /></section>;
}
function App() {
  const [count, setCount] = createSignal(1);
  return (
    <main>
      <button type="button" onClick={() => setCount(count() + 1)}>+</button>
      <Count.Provider value={count}><Panel /></Count.Provider>
    </main>
  );
}`,
        "import { createContext, createSignal, useContext } from 'solid-js';",
      ),
      ['button', 'button'],
    );
    // The signal getter is the value, so the read calls it directly.
    expect(code).not.toContain('createComponent(Count');
  });
});

describe('props.children', () => {
  it('renders children read more than once', async () => {
    const code = await expectSameBehavior(
      'children-twice',
      app(`function Twice(props) {
  return <div><p>{props.children}</p><p>{props.children}</p></div>;
}
function App() {
  const [count, setCount] = createSignal(0);
  return (
    <main>
      <button type="button" onClick={() => setCount(count() + 1)}>+</button>
      <Twice><b>{count()}</b></Twice>
    </main>
  );
}`),
      ['button'],
    );
    expect(code).not.toContain('Twice');
  });

  it('resolves children with the children() helper', async () => {
    await expectSameBehavior(
      'children-helper',
      app(
        `function List(props) {
  const resolved = children(() => props.children);
  return <ul data-count={resolved.toArray().length}>{resolved()}</ul>;
}
function App() {
  const [extra, setExtra] = createSignal(false);
  return (
    <main>
      <button type="button" onClick={() => setExtra(!extra())}>toggle</button>
      <List>
        <li>a</li>
        <li>b</li>
        {extra() && <li>c</li>}
      </List>
    </main>
  );
}`,
        "import { children, createSignal } from 'solid-js';",
      ),
      ['button', 'button'],
    );
  });

  it('calls children passed as a function', async () => {
    const code = await expectSameBehavior(
      'children-render-prop',
      app(
        `function Pair(props) {
  return <div>{props.children('left')} | {props.children('right')}</div>;
}
function Single(props) {
  return <p>{props.children(42)}</p>;
}
function App() {
  return (
    <main>
      <Pair>{(side) => <b>{side}</b>}</Pair>
      <Single>{(value) => <i>{value}</i>}</Single>
    </main>
  );
}`,
        '',
      ),
    );
    // A function read twice is stored once, so both calls share it.
    expect(code).toMatch(/const children\$1 = \(side\) =>/);
    expect(code).toContain('children$1("left")');
    expect(code).toContain('children$1("right")');
  });

  it('passes children through control flow', async () => {
    const code = await expectSameBehavior(
      'children-control-flow',
      app(
        `function Toggle(props) {
  return (
    <section>
      <Show when={props.open} fallback={<em>closed</em>}>{props.children}</Show>
    </section>
  );
}
function App() {
  const [open, setOpen] = createSignal(false);
  return (
    <main>
      <button type="button" onClick={() => setOpen(!open())}>toggle</button>
      <Toggle open={open()}>
        <p>first</p>
        <p>second</p>
      </Toggle>
    </main>
  );
}`,
        "import { createSignal, Show } from 'solid-js';",
      ),
      ['button', 'button'],
    );
    expect(code).not.toContain('Toggle');
  });

  it('keeps text around spliced children', async () => {
    await expectSameBehavior(
      'children-text',
      app(
        `function Label(props) {
  return (
    <span>
      Hello {props.children}!
    </span>
  );
}
function App() {
  const [name, setName] = createSignal('world');
  return (
    <main>
      <button type="button" onClick={() => setName('Solid')}>rename</button>
      <Label>
        dear
        {name()}
      </Label>
      <Label>{name()}</Label>
      <Label />
    </main>
  );
}`,
      ),
      ['button'],
    );
  });

  it('reads children in statements', async () => {
    await expectSameBehavior(
      'children-statement',
      app(`function Card(props) {
  const content = props.children;
  const [open, setOpen] = createSignal(true);
  return (
    <section>
      <button type="button" onClick={() => setOpen(!open())}>toggle</button>
      {open() ? content : <em>hidden</em>}
    </section>
  );
}
function App() {
  return (
    <main>
      <Card><p>body</p></Card>
    </main>
  );
}`),
      ['button', 'button'],
    );
  });

  it('falls back when there are no children', async () => {
    const code = await expectSameBehavior(
      'children-fallback',
      app(
        `function Slot(props) {
  return <div>{props.children ?? <em>empty</em>}</div>;
}
function App() {
  return (
    <main>
      <Slot />
      <Slot><b>filled</b></Slot>
    </main>
  );
}`,
        '',
      ),
    );
    expect(code).not.toContain('Slot');
  });

  it('forwards children to another component', async () => {
    const code = await expectSameBehavior(
      'children-forward',
      app(
        `function Inner(props) {
  return <div class="inner">{props.children}</div>;
}
function Outer(props) {
  return <section><Inner>{props.children}</Inner></section>;
}
function App() {
  const [count, setCount] = createSignal(0);
  return (
    <main>
      <button type="button" onClick={() => setCount(count() + 1)}>+</button>
      <Outer><span>{count()}</span></Outer>
    </main>
  );
}`,
      ),
      ['button'],
    );
    expect(code).not.toContain('Outer');
    expect(code).not.toContain('Inner');
  });
});

describe('createMemo', () => {
  it('inlines a memo of a new object read once', async () => {
    const code = await expectSameBehavior(
      'memo-style',
      app(
        `function App() {
  const [dark, setDark] = createSignal(false);
  const style = createMemo(() => ({ color: dark() ? 'white' : 'black' }));
  return (
    <main>
      <button type="button" onClick={() => setDark(!dark())}>toggle</button>
      <p style={style()}>text</p>
    </main>
  );
}`,
        "import { createMemo, createSignal } from 'solid-js';",
      ),
      ['button', 'button'],
    );
    expect(code).not.toContain('createMemo(');
  });

  it('inlines a memo of a list passed to For', async () => {
    const code = await expectSameBehavior(
      'memo-for',
      app(
        `function App() {
  const [count, setCount] = createSignal(2);
  const rows = createMemo(() => [...Array.from({ length: count() }, (_, index) => ({ index }))]);
  return (
    <main>
      <button type="button" onClick={() => setCount(count() + 1)}>+</button>
      <ul>
        <For each={rows()}>{(row) => <li>{row.index}</li>}</For>
      </ul>
    </main>
  );
}`,
        "import { createMemo, createSignal, For } from 'solid-js';",
      ),
      ['button', 'button'],
    );
    expect(code).not.toContain('createMemo(');
  });

  it('inlines a memo of JSX and one with equals: false', async () => {
    const code = await expectSameBehavior(
      'memo-jsx',
      app(
        `function App() {
  const [name, setName] = createSignal('a');
  const badge = createMemo(() => <b>{name()}</b>);
  const length = createMemo(() => name().length, undefined, { equals: false });
  return (
    <main>
      <button type="button" onClick={() => setName(name() + 'b')}>grow</button>
      <p>{badge()}</p>
      <span>{length()}</span>
    </main>
  );
}`,
        "import { createMemo, createSignal } from 'solid-js';",
      ),
      ['button', 'button'],
    );
    expect(code).not.toContain('createMemo(');
  });

  it('keeps a memo read more than once', async () => {
    const code = await expectSameBehavior(
      'memo-shared',
      app(
        `function App() {
  const [count, setCount] = createSignal(1);
  const pair = createMemo(() => [count(), count() * 2]);
  return (
    <main>
      <button type="button" onClick={() => setCount(count() + 1)}>+</button>
      <p>{pair()[0]}</p>
      <p>{pair()[1]}</p>
    </main>
  );
}`,
        "import { createMemo, createSignal } from 'solid-js';",
      ),
      ['button'],
    );
    expect(code).toContain('createMemo(');
  });
});
