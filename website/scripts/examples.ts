/**
 * The examples on the landing page. Each one is a single module whose `App`
 * is rendered on the server, so every branch it keeps has to render there.
 */
export interface Example {
  id: string;
  title: string;
  summary: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'components',
    title: 'Small components',
    summary: 'Three components and a debug branch fold into the page that uses them.',
    code: `import { Show, createSignal } from 'solid-js';
import type { JSX } from '@solidjs/web';

const DEBUG = false;

function Icon(props: { name: string }) {
  return <span class={\`icon icon-\${props.name}\`} />;
}

function Button(props: { icon: string; onClick: () => void; children: JSX.Element }) {
  return (
    <button type="button" onClick={props.onClick}>
      <Icon name={props.icon} />
      {props.children}
    </button>
  );
}

function Counter(props: { label: string; start: number }) {
  const [count, setCount] = createSignal(props.start);
  return (
    <p class="counter">
      {props.label}: {count()}{' '}
      <Button icon="plus" onClick={() => setCount(count() + 1)}>
        Add
      </Button>
    </p>
  );
}

export function App() {
  return (
    <main>
      <h1>Hello</h1>
      <Show when={DEBUG}>
        <pre>debug panel</pre>
      </Show>
      <Counter label="Clicks" start={0} />
    </main>
  );
}
`,
  },
  {
    id: 'context',
    title: 'Context providers',
    summary: 'A provider whose readers are all visible is removed, with its owner.',
    code: `import { createContext, useContext } from 'solid-js';
import type { JSX } from '@solidjs/web';

const Theme = createContext<string>();

function Card(props: { title: string; children: JSX.Element }) {
  const theme = useContext(Theme);
  return (
    <article class={\`card card-\${theme}\`}>
      <h2>{props.title}</h2>
      <p>{props.children}</p>
    </article>
  );
}

function Badge(props: { children: JSX.Element }) {
  const theme = useContext(Theme);
  return <span class={\`badge badge-\${theme}\`}>{props.children}</span>;
}

export function App() {
  return (
    <Theme value="dark">
      <Card title="Releases">
        <Badge>new</Badge> Every read of the theme got its value.
      </Card>
    </Theme>
  );
}
`,
  },
  {
    id: 'lists',
    title: 'Constant lists',
    summary: 'A <For> over a constant array becomes one row per item, in one template.',
    code: `import { For } from 'solid-js';
import type { JSX } from '@solidjs/web';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
  { href: '/repl', label: 'REPL' },
  { href: '/blog', label: 'Blog' },
];

function NavLink(props: { href: string; children: JSX.Element }) {
  return (
    <li>
      <a class="nav-link" href={props.href}>
        {props.children}
      </a>
    </li>
  );
}

export function App() {
  return (
    <nav>
      <ul>
        <For each={LINKS}>
          {(link) => <NavLink href={link.href}>{link.label}</NavLink>}
        </For>
      </ul>
    </nav>
  );
}
`,
  },
  {
    id: 'flags',
    title: 'Build-time flags',
    summary: '<Switch>, <Show> and <Dynamic> resolve when their props are constants.',
    code: `import { Match, Show, Switch } from 'solid-js';
import { Dynamic } from '@solidjs/web';

const LAYOUT = 'compact';
const HEADING = 'h2';
const BANNER = true;

export function App() {
  return (
    <section>
      <Show when={BANNER} fallback={<p>No news</p>}>
        <p class="banner">Version 2 is out</p>
      </Show>
      <Dynamic component={HEADING}>Settings</Dynamic>
      <Switch fallback={<p>Unknown layout</p>}>
        <Match when={LAYOUT === 'wide'}>
          <div class="grid wide">wide</div>
        </Match>
        <Match when={LAYOUT === 'compact'}>
          <div class="grid compact">compact</div>
        </Match>
      </Switch>
    </section>
  );
}
`,
  },
  {
    id: 'props',
    title: 'Props with defaults',
    summary: 'merge() and omit() views fold into the attributes each call passes.',
    code: `import { merge, omit } from 'solid-js';
import type { JSX } from '@solidjs/web';

function Button(props: {
  type?: 'button' | 'submit';
  label: string;
  class?: string;
  onClick?: () => void;
}) {
  const merged = merge({ type: 'button' as const }, props);
  const rest = omit(merged, 'label');
  return (
    <button {...rest}>
      {props.label}
    </button>
  );
}

export function App(): JSX.Element {
  return (
    <form>
      <input name="email" />
      <Button label="Cancel" class="ghost" />
      <Button type="submit" label="Send" class="primary" />
    </form>
  );
}
`,
  },
  {
    id: 'memos',
    title: 'Memos',
    summary: 'A memo that always makes a new value, or never changes, becomes its computation.',
    code: `import { createMemo, createSignal } from 'solid-js';

const SIZE = 4;

export function App() {
  const [color, setColor] = createSignal('tomato');
  const style = createMemo(() => ({ color: color() }));
  const padding = createMemo(() => SIZE * 2);

  return (
    <p style={style()} onClick={() => setColor('teal')}>
      padding: {padding()}px
    </p>
  );
}
`,
  },
];
