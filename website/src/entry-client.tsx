import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import type { JSX } from '@solidjs/web';
import { hydrate } from '@solidjs/web';
import { Document } from './Document';
import type { Route } from './routes';
import { findRoute } from './routes';
import './styles.css';

// Each page is its own chunk, so the landing page and the docs never load the REPL.
const PAGES: Record<Route['id'], () => Promise<() => JSX.Element>> = {
  home: async () => (await import('./pages/Home')).Home,
  docs: async () => (await import('./pages/Docs')).Docs,
  repl: async () => (await import('./pages/ReplPage')).ReplPage,
};

const route = findRoute(location.pathname);
if (route) {
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
