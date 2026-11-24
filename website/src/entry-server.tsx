import type { JSX } from '@solidjs/web';
import { getRequestEvent, renderToStream } from '@solidjs/web';
import manifest from 'virtual:solid-manifest';
import { Document } from './Document';
import { findDoc } from './lib/docs-server';
import { DocsPage } from './pages/Docs';
import { Home } from './pages/Home';
import { NotFound } from './pages/NotFound';
import { ReplPage } from './pages/ReplPage';
import type { Route } from './routes';
import { NOT_FOUND, findRoute } from './routes';

const PAGES: Record<Exclude<Route['id'], 'docs'>, () => JSX.Element> = {
  home: Home,
  repl: ReplPage,
  'not-found': NotFound,
};

/** The page for a route: a docs page needs its doc, and a missing doc is the not-found page. */
function resolvePage(route: Route): { route: Route; Page: () => JSX.Element } {
  if (route.id !== 'docs') {
    return { route, Page: PAGES[route.id] };
  }
  const doc = findDoc(route.slug ?? '');
  if (!doc) {
    return { route: NOT_FOUND, Page: NotFound };
  }
  return {
    route: { ...route, title: `${doc.title} · solid-optimizer docs`, description: doc.description },
    Page: () => <DocsPage doc={doc} />,
  };
}

/** Renders the page at the request's path, or the not-found page. The build prerenders every route through this. */
export function render(request: Request): Response | ReturnType<typeof renderToStream> {
  const { route, Page } = resolvePage(findRoute(new URL(request.url).pathname) ?? NOT_FOUND);
  return renderToStream(
    () => (
      <Document route={route}>
        <Page />
      </Document>
    ),
    { manifest, nonce: getRequestEvent()?.nonce ?? undefined },
  );
}
