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
  it('finds the only module that uses a component as a tag', async () => {
    const usage = await index({
      '/main.jsx': `import { Page } from './page'; render(() => <Page />);`,
      '/page.jsx': `import { Card } from './card'; export const Page = () => <Card><Card /></Card>;`,
      '/card.jsx': `export const Card = (props) => <div>{props.children}</div>;`,
    });
    expect(usage.isOnlyUser('/card.jsx', 'Card', '/page.jsx', NONE)).toBe(true);
    expect(usage.isOnlyUser('/card.jsx', 'Card', '/main.jsx', NONE)).toBe(false);
  });

  it('counts every module that uses it', async () => {
    const usage = await index({
      '/main.jsx': `import { Card } from './card'; import { Page } from './page'; render(() => <><Page /><Card /></>);`,
      '/page.jsx': `import { Card } from './card'; export const Page = () => <Card />;`,
      '/card.jsx': `export const Card = () => <div />;`,
    });
    expect(usage.isOnlyUser('/card.jsx', 'Card', '/page.jsx', NONE)).toBe(false);
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
    expect(usage.isOnlyUser('/card.jsx', 'Card', '/page.jsx', NONE)).toBe(false);
  });

  it('cannot follow re-exports or dynamic imports', async () => {
    const usage = await index({
      '/main.jsx': `import { Card } from './barrel'; const lazy = () => import('./lazy'); render(() => <Card />);`,
      '/barrel.jsx': `export { Card } from './card';`,
      '/card.jsx': `export const Card = () => <div />;`,
      '/lazy.jsx': `export default () => <div />;`,
    });
    expect(usage.isOnlyUser('/card.jsx', 'Card', '/main.jsx', NONE)).toBe(false);
    expect(usage.isOnlyUser('/lazy.jsx', 'default', '/main.jsx', NONE)).toBe(false);
  });

  it('moves the uses inside a copied component to the module it moved to', async () => {
    const usage = await index({
      '/main.jsx': `import { Counter } from './counter'; render(() => <Counter />);`,
      '/counter.jsx': `import { Label } from './label'; export function Counter() { return <Label />; }`,
      '/label.jsx': `export const Label = () => <span />;`,
    });
    expect(usage.isOnlyUser('/label.jsx', 'Label', '/main.jsx', NONE)).toBe(false);
    const absorbed = new Map([['/counter.jsx', new Set(['Counter'])]]);
    expect(usage.isOnlyUser('/label.jsx', 'Label', '/main.jsx', absorbed)).toBe(true);
  });

  it('keeps the exports of an entry, which are its public API', async () => {
    const usage = await index(
      {
        '/main.jsx': `export const App = () => <div />;`,
        '/other.jsx': `import { App } from './main'; render(() => <App />);`,
      },
      ['/main.jsx', '/other.jsx'],
    );
    expect(usage.isOnlyUser('/main.jsx', 'App', '/other.jsx', NONE)).toBe(false);
  });
});
