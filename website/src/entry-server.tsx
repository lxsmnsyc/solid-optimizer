import type { JSX } from '@solidjs/web';
import { getRequestEvent, renderToStream } from '@solidjs/web';
import manifest from 'virtual:solid-manifest';
import { Document } from './Document';
import { Docs } from './pages/Docs';
import { Home } from './pages/Home';
import { ReplPage } from './pages/ReplPage';
import type { Route } from './routes';
import { findRoute } from './routes';

const PAGES: Record<Route['id'], () => JSX.Element> = {
  home: Home,
  docs: Docs,
  repl: ReplPage,
};

/** Renders the page at the request's path. The build prerenders every route through this. */
export function render(request: Request): Response | ReturnType<typeof renderToStream> {
  const route = findRoute(new URL(request.url).pathname);
  if (!route) {
    return new Response('Not found', { status: 404 });
  }
  const Page = PAGES[route.id];
  return renderToStream(
    () => (
      <Document route={route}>
        <Page />
      </Document>
    ),
    { manifest, nonce: getRequestEvent()?.nonce ?? undefined },
  );
}
