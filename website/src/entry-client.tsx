import type { JSX } from '@solidjs/web';
import { hydrate } from '@solidjs/web';
import { Document } from './Document';
import type { Route } from './routes';
import { NOT_FOUND, findRoute } from './routes';
import './styles/tokens.css';
import './styles/banig.css';
import './styles.css';

// Each page is its own chunk, so the landing page and the docs never load the REPL.
const PAGES: Record<Route['id'], () => Promise<() => JSX.Element>> = {
  home: async () => (await import('./pages/Home')).Home,
  docs: async () => (await import('./pages/Docs')).Docs,
  repl: async () => (await import('./pages/ReplPage')).ReplPage,
  'not-found': async () => (await import('./pages/NotFound')).NotFound,
};

const route = findRoute(location.pathname) ?? NOT_FOUND;
{
  const Page = await PAGES[route.id]();
  hydrate(
    () => (
      <Document route={route}>
        <Page />
      </Document>
    ),
    document,
  );
}
