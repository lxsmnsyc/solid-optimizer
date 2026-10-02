import { describe, expect, it } from 'vitest';
import type { UsageIndex } from '../src/vite/usage';
import { buildUsageIndex } from '../src/vite/usage';

/** Builds the index over in-memory modules, with `./name` resolving to `/name.jsx`. */
async function index(
  modules: Record<string, string>,
  entries = ['/main.jsx'],
): Promise<UsageIndex> {
  return buildUsageIndex(entries, {
    resolve: async (source) => {
      const id = `/${source.replace(/^\.\//, '')}.jsx`;
      return Promise.resolve(id in modules ? id : undefined);
    },
    read: async (id) => Promise.resolve(modules[id]),
  });
}

const NONE = new Map<string, Set<string>>();

describe('buildUsageIndex', () => {
  it('counts the modules that use a component as a tag', async () => {
    const usage = await index({
      '/main.jsx': `import { Page } from './page'; render(() => <Page />);`,
      '/page.jsx': `import { Card } from './card'; export const Page = () => <Card><Card /></Card>;`,
      '/card.jsx': `export const Card = (props) => <div>{props.children}</div>;`,
    });
    expect(usage.users('/card.jsx', 'Card', '/page.jsx', NONE)).toBe(1);
    expect(usage.users('/card.jsx', 'Card', '/main.jsx', NONE)).toBe(2);
  });

  it('counts every module that uses it', async () => {
    const usage = await index({
      '/main.jsx': `import { Card } from './card'; import { Page } from './page'; render(() => <><Page /><Card /></>);`,
      '/page.jsx': `import { Card } from './card'; export const Page = () => <Card />;`,
      '/card.jsx': `export const Card = () => <div />;`,
    });
    expect(usage.users('/card.jsx', 'Card', '/page.jsx', NONE)).toBe(2);
  });

  it('treats any use but a tag as another user', async () => {
    const usage = await index({
      '/main.jsx': `import { Card } from './card'; import { Page } from './page'; register(Card); render(() => <Page />);`,
      '/page.jsx': `import { Card } from './card'; export const Page = () => <Card />;`,
      '/card.jsx': `export const Card = () => <div />;
export const Other = () => <Card />;
export const Lazy = () => <div />;`,
    });
    // `main` passes it as a value, and its own module renders it.
    expect(usage.users('/card.jsx', 'Card', '/page.jsx', NONE)).toBe(0);
  });

  it('cannot follow re-exports or dynamic imports', async () => {
    const usage = await index({
      '/main.jsx': `import { Card } from './barrel'; const lazy = () => import('./lazy'); render(() => <Card />);`,
      '/barrel.jsx': `export { Card } from './card';`,
      '/card.jsx': `export const Card = () => <div />;`,
      '/lazy.jsx': `export default () => <div />;`,
    });
    expect(usage.users('/card.jsx', 'Card', '/main.jsx', NONE)).toBe(0);
    expect(usage.users('/lazy.jsx', 'default', '/main.jsx', NONE)).toBe(0);
  });

  it('moves the uses inside a copied component to the module it moved to', async () => {
    const usage = await index({
      '/main.jsx': `import { Counter } from './counter'; render(() => <Counter />);`,
      '/counter.jsx': `import { Label } from './label'; export function Counter() { return <Label />; }`,
      '/label.jsx': `export const Label = () => <span />;`,
    });
    expect(usage.users('/label.jsx', 'Label', '/main.jsx', NONE)).toBe(2);
    const absorbed = new Map([['/counter.jsx', new Set(['Counter'])]]);
    expect(usage.users('/label.jsx', 'Label', '/main.jsx', absorbed)).toBe(1);
  });

  it('counts no users when a user is imported back, which never gets a copy', async () => {
    const usage = await index({
      '/main.jsx': `import { Even } from './even'; render(() => <Even />);`,
      '/even.jsx': `import { Odd } from './odd'; export const Even = () => <Odd />;`,
      '/odd.jsx': `import { Even } from './even'; export const Odd = () => <Even />;`,
    });
    expect(usage.users('/even.jsx', 'Even', '/main.jsx', NONE)).toBe(0);
  });

  it('keeps the exports of an entry, which are its public API', async () => {
    const usage = await index(
      {
        '/main.jsx': `export const App = () => <div />;`,
        '/other.jsx': `import { App } from './main'; render(() => <App />);`,
      },
      ['/main.jsx', '/other.jsx'],
    );
    expect(usage.users('/main.jsx', 'App', '/other.jsx', NONE)).toBe(0);
  });
});
