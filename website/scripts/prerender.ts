/**
 * Prerenders every page of the built site into static HTML. `vite build`
 * writes the server handler to `dist/server`. This calls it for each route and
 * writes the answer into `dist/client`, which is what Vercel serves. The
 * client then hydrates the HTML.
 *
 * Usage: `node scripts/prerender.ts` after `vite build`. `pnpm build` runs both.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROUTES } from '../src/routes.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'dist', 'client');
const SERVER = path.join(ROOT, 'dist', 'server', 'server.js');

interface Handler {
  handleRequest(request: Request, options?: { renderMode?: 'stream' | 'async' }): Promise<Response>;
}

function isHandler(value: unknown): value is Handler {
  return (
    typeof value === 'object' &&
    value !== null &&
    'handleRequest' in value &&
    typeof value.handleRequest === 'function'
  );
}

const handler: unknown = await import(pathToFileURL(SERVER).href);
if (!isHandler(handler)) {
  throw new TypeError(`${SERVER} has no handleRequest`);
}

for (const route of ROUTES) {
  // `async` waits for every boundary, so the file holds the whole page and no streaming scripts.
  const response = await handler.handleRequest(
    new Request(new URL(route.path, 'http://localhost')),
    {
      renderMode: 'async',
    },
  );
  if (!response.ok) {
    throw new Error(`Prerendering ${route.path} failed: the handler answered ${response.status}`);
  }
  const file = path.join(CLIENT, route.path, 'index.html');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, await response.text());
  process.stdout.write(`Wrote ${path.relative(ROOT, file)}\n`);
}
