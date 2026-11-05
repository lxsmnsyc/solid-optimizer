import type { VirtualFile } from './protocol';

export interface Preset {
  id: string;
  label: string;
  files: VirtualFile[];
}

export const PRESETS: Preset[] = [
  {
    id: 'components',
    label: 'Components',
    files: [
      {
        name: 'App.tsx',
        code: `import { Show } from 'solid-js';
import { DEBUG } from './config';
import { Counter } from './Counter';

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
        name: 'Counter.tsx',
        code: `import { createSignal } from 'solid-js';
import { Button } from './Button';

export function Counter(props: { label: string; start: number }) {
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
`,
      },
      {
        name: 'Button.tsx',
        code: `import type { JSX } from '@solidjs/web';

function Icon(props: { name: string }) {
  return <span class={\`icon icon-\${props.name}\`} />;
}

export function Button(props: {
  icon: string;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <button type="button" onClick={props.onClick}>
      <Icon name={props.icon} />
      {props.children}
    </button>
  );
}
`,
      },
      {
        name: 'config.ts',
        code: `export const DEBUG = false;
`,
      },
    ],
  },
  {
    id: 'context',
    label: 'Context',
    files: [
      {
        name: 'App.tsx',
        code: `import { Theme } from './theme';
import { Card } from './Card';

export function App() {
  return (
    <Theme value="dark">
      <Card title="Inlined">
        The provider is gone, and every read got its value.
      </Card>
    </Theme>
  );
}
`,
      },
      {
        name: 'Card.tsx',
        code: `import { useContext } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { Theme } from './theme';

export function Card(props: { title: string; children: JSX.Element }) {
  const theme = useContext(Theme);
  return (
    <article class={\`card card-\${theme}\`}>
      <h2>{props.title}</h2>
      <p>{props.children}</p>
    </article>
  );
}
`,
      },
      {
        name: 'theme.ts',
        code: `import { createContext } from 'solid-js';

export const Theme = createContext<string>();
`,
      },
    ],
  },
  {
    id: 'lists',
    label: 'Constant lists',
    files: [
      {
        name: 'App.tsx',
        code: `import { For } from 'solid-js';
import { NavLink } from './NavLink';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
  { href: '/repl', label: 'REPL' },
];

export function App() {
  return (
    <nav>
      <For each={LINKS}>
        {(link) => <NavLink href={link.href}>{link.label}</NavLink>}
      </For>
    </nav>
  );
}
`,
      },
      {
        name: 'NavLink.tsx',
        code: `import type { JSX } from '@solidjs/web';

export function NavLink(props: { href: string; children: JSX.Element }) {
  return (
    <a class="nav-link" href={props.href}>
      {props.children}
    </a>
  );
}
`,
      },
    ],
  },
  {
    id: 'memos',
    label: 'Memos',
    files: [
      {
        name: 'App.tsx',
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
    ],
  },
];
