import type { JSX } from '@solidjs/web';
import { HydrationScript } from '@solidjs/web';
import type { Route } from './routes';

/**
 * The whole HTML document of a page. The server renders it around the page,
 * and the client hydrates it, so the head is the same on both.
 */
export function Document(props: { route: Route; children: JSX.Element }): JSX.Element {
  // Link previews need absolute URLs. See `SITE_URL` in vite.config.ts.
  const url = new URL(props.route.path, import.meta.env.SITE_URL).href;
  const image = new URL('/og.png', import.meta.env.SITE_URL).href;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#070b14" />
        <title>{props.route.title}</title>
        <meta name="description" content={props.route.description} />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="canonical" href={url} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="solid-optimizer" />
        <meta property="og:title" content={props.route.title} />
        <meta property="og:description" content={props.route.description} />
        <meta property="og:url" content={url} />
        <meta property="og:image" content={image} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="solid-optimizer: Fewer templates. Same app." />
        <meta name="twitter:card" content="summary_large_image" />
        <HydrationScript />
        {/* The server rewrites this path to the built entry. */}
        <script type="module" src="/src/entry-client.tsx" async />
      </head>
      <body>
        <div id="app">{props.children}</div>
      </body>
    </html>
  );
}
