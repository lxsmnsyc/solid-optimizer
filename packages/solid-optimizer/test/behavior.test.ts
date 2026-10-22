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
    'main.tsx': `import { render } from '@solidjs/web';
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
      <Theme value="dark">
        <div><Label /></div>
      </Theme>
    </main>
  );
}`,
        "import { createContext, useContext } from 'solid-js';",
      ),
    );
    // The consumer outside the provider reads the default. The one inside
    // moves out with the provider's value, and the provider is removed.
    expect(code).toMatch(/const theme\$\d+ = useContext\(Theme\);/);
    expect(code).not.toContain('createComponent(Label');
    expect(code).not.toContain('createComponent(Theme');
  });

  it('keeps a consumer under an inlined provider', async () => {
    const code = await expectSameBehavior(
      'context-provider',
      app(
        `const Theme = createContext('light');
function ThemeProvider(props) {
  return <Theme value={props.theme}>{props.children}</Theme>;
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
      <Theme value="dark"><Label /></Theme>
      <Theme value="blue"><Theme value="red"><Label /></Theme></Theme>
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
      <Count value={count}><Panel /></Count>
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

describe('props spread', () => {
  it('spreads the props onto an element the same once inlined', async () => {
    const code = await expectSameBehavior(
      'props-spread',
      app(
        `function Box(props) {
  return <section {...props} />;
}
function App() {
  const [tone, setTone] = createSignal('dark');
  return (
    <main>
      <Box id="box" class={tone()} onClick={() => setTone(tone() === 'dark' ? 'light' : 'dark')}>
        <p>{tone()}</p>
      </Box>
    </main>
  );
}`,
      ),
      ['#box', '#box'],
    );
    expect(code).not.toContain('createComponent(Box');
  });
});

describe('constant lists', () => {
  it('renders an unrolled <For> the same, with stateful rows', async () => {
    const code = await expectSameBehavior(
      'for-constant-list',
      app(
        `const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
];
function App() {
  const [active, setActive] = createSignal('/');
  return (
    <nav>
      <For each={LINKS}>
        {(link, index) => (
          <a
            href={link.href}
            data-index={index()}
            class={active() === link.href ? 'active' : ''}
            onClick={(event) => {
              event.preventDefault();
              setActive(link.href);
            }}
          >
            {link.label}
          </a>
        )}
      </For>
    </nav>
  );
}`,
        "import { createSignal, For } from 'solid-js';",
      ),
      ['a[data-index="1"]', 'a[data-index="0"]'],
    );
    expect(code).not.toContain('mapArray');
  });
});

describe('children helper', () => {
  it('renders children resolved by the helper the same once it is inlined', async () => {
    const code = await expectSameBehavior(
      'children-helper',
      app(
        `function Box(props) {
  const resolved = children(() => props.children);
  return <section class="box">{resolved()}</section>;
}
function App() {
  const [count, setCount] = createSignal(0);
  return (
    <main>
      <Box>
        <button onClick={() => setCount(count() + 1)}>{count()}</button>
      </Box>
    </main>
  );
}`,
        "import { children, createSignal } from 'solid-js';",
      ),
      ['button', 'button'],
    );
    expect(code).not.toContain('children(');
  });
});

describe('dynamic', () => {
  it('renders a known component through <Dynamic> the same as a call', async () => {
    const code = await expectSameBehavior(
      'dynamic-component',
      app(
        `function Counter(props) {
  const [count, setCount] = createSignal(props.start);
  return (
    <button onClick={() => setCount(count() + 1)}>
      {props.label} {count()}
    </button>
  );
}
function App() {
  const [label, setLabel] = createSignal('a');
  return (
    <main>
      <i id="rename" onClick={() => setLabel('b')} />
      <Dynamic component={Counter} label={label()} start={1} />
    </main>
  );
}`,
        "import { createSignal } from 'solid-js';\nimport { Dynamic } from '@solidjs/web';",
      ),
      ['button', '#rename', 'button'],
    );
    expect(code).not.toContain('Dynamic');
  });
});

describe('callback hosts', () => {
  it('keeps each row its own state when a stateful component inlines into <For>', async () => {
    const code = await expectSameBehavior(
      'for-row-state',
      app(
        `function Row(props) {
  const [on, setOn] = createSignal(false);
  return (
    <li class={on() ? 'on' : 'off'} onClick={() => setOn(!on())}>
      {props.name}
    </li>
  );
}
function App() {
  const [items, setItems] = createSignal(['a', 'b']);
  return (
    <main>
      <button id="add" onClick={() => setItems([...items(), 'c'])} />
      <button id="drop" onClick={() => setItems(items().slice(1))} />
      <ul>
        <For each={items()}>{(item) => <Row name={item} />}</For>
      </ul>
    </main>
  );
}`,
        "import { createSignal, For } from 'solid-js';",
      ),
      ['li:nth-child(2)', '#add', 'li:nth-child(3)', '#drop', 'li:nth-child(1)'],
    );
    expect(code).not.toContain('createComponent(Row');
  });
});

describe('refs', () => {
  it('sets a ref on an element the same', async () => {
    await expectSameBehavior(
      'element-ref',
      app(
        `function App() {
  let el;
  const [seen, setSeen] = createSignal('none');
  return (
    <main>
      <input id="field" value="a" ref={el} />
      <button id="read" onClick={() => setSeen(el ? el.tagName : 'none')} />
      <p>{seen()}</p>
    </main>
  );
}`,
      ),
      ['#read'],
    );
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
    const stored = /const (children\$\d+) = \(side\$\d+\) =>/.exec(code)?.[1];
    expect(stored).toBeDefined();
    expect(code).toContain(`${stored ?? ''}("left")`);
    expect(code).toContain(`${stored ?? ''}("right")`);
    // A function called once with a constant becomes its JSX, which joins the template.
    expect(code).not.toContain('(42)');
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
  const length = createMemo(() => name().length, { equals: false });
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

describe('merge() and omit()', () => {
  it('renders defaults and reactive props the same', async () => {
    const code = await expectSameBehavior(
      'views-merge',
      app(
        `function Badge(props) {
  const merged = merge({ tone: 'plain', label: 'none' }, props);
  return <span class={merged.tone}>{merged.label}</span>;
}
function App() {
  const [count, setCount] = createSignal(0);
  return (
    <main>
      <button type="button" onClick={() => setCount(count() + 1)}>+</button>
      <Badge />
      <Badge tone="loud" label={String(count())} />
      <Badge tone={count() > 0 ? 'hot' : undefined} />
    </main>
  );
}`,
        "import { createSignal, merge } from 'solid-js';",
      ),
      ['button', 'button'],
    );
    expect(code).not.toContain('Badge');
  });

  it('spreads the rest of the props, handlers and children included', async () => {
    const code = await expectSameBehavior(
      'views-omit',
      app(
        `function Action(props) {
  const rest = omit(props, 'tone');
  return <button type="button" class={props.tone} {...rest} />;
}
function App() {
  const [count, setCount] = createSignal(0);
  return (
    <main>
      <Action tone="primary" title={\`clicked \${count()}\`} onClick={() => setCount(count() + 1)}>
        Clicks: {count()}
      </Action>
    </main>
  );
}`,
        "import { createSignal, omit } from 'solid-js';",
      ),
      ['button', 'button'],
    );
    expect(code).not.toContain('Action');
    expect(code).not.toContain('omit(');
  });
});
