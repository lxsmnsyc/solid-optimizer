/**
 * The site's pages. The server renders each one, the build prerenders them
 * all, and the client loads only the code of the page it hydrates.
 */
export interface Route {
  readonly id: 'home' | 'docs' | 'repl' | 'not-found';
  /** The path, with a trailing slash, as the build writes it. */
  readonly path: string;
  readonly title: string;
  readonly description: string;
  /** The file the build writes, when it is not `index.html` in the path's folder. */
  readonly file?: string;
}

export const ROUTES: readonly Route[] = [
  {
    id: 'home',
    path: '/',
    title: 'solid-optimizer · compile-time optimizer for SolidJS',
    description:
      'solid-optimizer inlines components, removes context providers, and folds control flow in SolidJS 2.0 JSX at build time.',
  },
  {
    id: 'docs',
    path: '/docs/',
    title: 'Docs · solid-optimizer',
    description:
      'How to set up and configure solid-optimizer, its Vite plugin, and what each pass does.',
  },
  {
    id: 'repl',
    path: '/repl/',
    title: 'REPL · solid-optimizer',
    description:
      'Run solid-optimizer and Solid’s JSX transform in the browser, and compare the output.',
  },
  {
    id: 'not-found',
    path: '/404/',
    title: 'Page not found · solid-optimizer',
    description: 'This page does not exist.',
    // Vercel answers any path that has no file with `404.html` and a 404 status.
    file: '404.html',
  },
];

/** The route of the page shown for a path that has no page. */
export const NOT_FOUND: Route = ROUTES[ROUTES.length - 1];

/** Finds the route of a path. `/docs` and `/docs/index.html` find `/docs/`. */
export function findRoute(pathname: string): Route | undefined {
  let path = pathname.replace(/index\.html$/, '');
  if (!path.endsWith('/')) {
    path += '/';
  }
  for (const route of ROUTES) {
    if (route.path === path) {
      return route;
    }
  }
  return undefined;
}
