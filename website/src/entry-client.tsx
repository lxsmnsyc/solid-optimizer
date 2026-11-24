import type { JSX } from '@solidjs/web';
import { hydrate } from '@solidjs/web';
import { Document } from './Document';
import type { Route } from './routes';
import { NOT_FOUND, findRoute } from './routes';
import './styles/tokens.css';
import './styles/banig.css';
import './styles.css';
import './search/bind';

// Each page is its own chunk, so the landing page and the docs never load the REPL.
const PAGES: Record<Exclude<Route['id'], 'docs'>, () => Promise<() => JSX.Element>> = {
  home: async () => (await import('./pages/Home')).Home,
  repl: async () => (await import('./pages/ReplPage')).ReplPage,
  'not-found': async () => (await import('./pages/NotFound')).NotFound,
};

/** The page for a route, as the server resolved it. A docs page loads only its own doc. */
async function resolvePage(route: Route): Promise<{ route: Route; Page: () => JSX.Element }> {
  if (route.id !== 'docs') {
    return { route, Page: await PAGES[route.id]() };
  }
  const [{ loadDoc }, { DocsPage }] = await Promise.all([
    import('./lib/docs'),
    import('./pages/Docs'),
  ]);
  const doc = await loadDoc(route.slug ?? '');
  if (!doc) {
    return { route: NOT_FOUND, Page: await PAGES['not-found']() };
  }
  return {
    route: { ...route, title: `${doc.title} · solid-optimizer docs`, description: doc.description },
    Page: () => <DocsPage doc={doc} />,
  };
}

const { route, Page } = await resolvePage(findRoute(location.pathname) ?? NOT_FOUND);
hydrate(
  () => (
    <Document route={route}>
      <Page />
    </Document>
  ),
  document,
);
