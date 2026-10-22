/**
 * Runs every build from `build.ts` in a browser and checks that the optimized
 * app renders the same DOM as the plain one, on each route.
 *
 * The Hacker News API is replaced by the responses in `fixtures/`, so every
 * run renders the same stories.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserPage, BrowserWindow, Node } from 'happy-dom';
import { Browser } from 'happy-dom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODES = ['default', 'vendor', 'single'];

/** The story in `fixtures/item.json`, and its author. */
function readItem(): { id: number; user: string } {
  const value: unknown = JSON.parse(readFileSync(path.join(HERE, 'fixtures/item.json'), 'utf8'));
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    !('user' in value) ||
    typeof value.id !== 'number' ||
    typeof value.user !== 'string'
  ) {
    throw new TypeError('fixtures/item.json is not a story');
  }
  return { id: value.id, user: value.user };
}

const item = readItem();

interface Route {
  readonly path: string;
  /** An element that shows the route has loaded its data. */
  readonly ready: string;
  /** An element to click once it has, to check updates too. */
  readonly click?: string;
}

const ROUTES: Route[] = [
  { path: '/', ready: '.news-item' },
  { path: '/new', ready: '.news-item' },
  { path: `/stories/${String(item.id)}`, ready: '.item-view', click: '.toggle a' },
  { path: `/users/${item.user}`, ready: '.user-view h1' },
];

/** The fixture each API path answers with. */
function fixture(api: string): string {
  if (api.startsWith('hn/news')) {
    return 'news.json';
  }
  if (api.startsWith('hn/newest')) {
    return 'newest.json';
  }
  if (api.startsWith('hn/item/')) {
    return 'item.json';
  }
  return 'user.json';
}

/**
 * The markup of a node with its attributes sorted and comments and scripts
 * left out. The optimized build can move an attribute into a template, which
 * changes the order attributes are set in but not what the element has.
 */
function normalize(node: Node, window: BrowserWindow): string {
  if (node instanceof window.Text) {
    return node.textContent;
  }
  if (!(node instanceof window.Element) || node.tagName === 'SCRIPT') {
    return '';
  }
  const attributes = Array.from(node.attributes)
    .map((attribute) => ` ${attribute.name}="${attribute.value}"`)
    .sort()
    .join('');
  const children = Array.from(node.childNodes)
    .map((child) => normalize(child, window))
    .join('');
  const tag = node.tagName.toLowerCase();
  return `<${tag}${attributes}>${children}</${tag}>`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Waits for `selector` to match. The router's cache keeps an interval
 * running, so `waitUntilComplete` would never return.
 */
async function waitFor(page: BrowserPage, selector: string): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (page.mainFrame.document.querySelector(selector)) {
      // Let the rest of the data render too.
      await sleep(50);
      return true;
    }
    // oxlint-disable-next-line no-await-in-loop
    await sleep(25);
  }
  return false;
}

/**
 * Loads a build and returns the page markup on each route, before and after
 * its click.
 */
async function snapshots(dir: string): Promise<string[]> {
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    if (url.startsWith('/api/')) {
      response.setHeader('content-type', 'application/json');
      response.end(readFileSync(path.join(HERE, 'fixtures', fixture(url.slice(5)))));
      return;
    }
    const file = path.join(dir, url.split('?')[0] ?? '');
    if (url.endsWith('.js') && existsSync(file)) {
      // The app fetches from the Hacker News API, which this server answers instead.
      const origin = `http://${request.headers.host ?? ''}`;
      response.setHeader('content-type', 'text/javascript');
      response.end(
        readFileSync(file, 'utf8')
          .replaceAll('https://node-hnapi.herokuapp.com/', `${origin}/api/hn/`)
          .replaceAll('https://hacker-news.firebaseio.com/v0/', `${origin}/api/`)
          .replaceAll(/import\.meta/g, `({ url: ${JSON.stringify(origin + url)} })`),
      );
      return;
    }
    // Every other path is a route of the app.
    response.setHeader('content-type', 'text/html');
    response.end(readFileSync(path.join(dir, 'index.html')));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const browser = new Browser({
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      disableCSSFileLoading: true,
    },
  });
  const result: string[] = [];
  try {
    for (const route of ROUTES) {
      const page = browser.newPage();
      // oxlint-disable-next-line no-await-in-loop
      await page.goto(`http://localhost:${String(port)}${route.path}`);
      // oxlint-disable-next-line no-await-in-loop
      const loaded = await waitFor(page, route.ready);
      const { document, window } = page.mainFrame;
      result.push(loaded ? normalize(document.body, window) : '');
      if (route.click) {
        document
          .querySelector(route.click)
          ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        // oxlint-disable-next-line no-await-in-loop
        await sleep(50);
        result.push(normalize(document.body, window));
      }
      // oxlint-disable-next-line no-await-in-loop
      await page.abort();
      // oxlint-disable-next-line no-await-in-loop
      await page.close();
    }
    return result;
  } finally {
    await browser.close();
    server.close();
  }
}

const labels = ROUTES.flatMap((route) =>
  route.click ? [route.path, `${route.path} after a click`] : [route.path],
);
let failures = 0;
for (const mode of MODES) {
  // oxlint-disable-next-line no-await-in-loop
  const plain = await snapshots(path.join(HERE, 'dist', mode, 'plain'));
  // oxlint-disable-next-line no-await-in-loop
  const optimized = await snapshots(path.join(HERE, 'dist', mode, 'optimized'));
  for (const [index, label] of labels.entries()) {
    const before = plain[index] ?? '';
    const after = optimized[index] ?? '';
    // A click has to change the page, or comparing after it proves nothing.
    const clicked = label.endsWith('after a click') ? before !== plain[index - 1] : true;
    const ok = before !== '' && before === after && clicked;
    if (!ok) {
      failures += 1;
    }
    let note = '';
    if (!before) {
      note = ' (did not load)';
    } else if (!clicked) {
      note = ' (the click changed nothing)';
    }
    process.stdout.write(`${ok ? '✓' : '✗'} ${mode} ${label}${note}\n`);
    if (before !== after) {
      process.stdout.write(`  plain:     ${before}\n  optimized: ${after}\n`);
    }
  }
}
process.exitCode = failures > 0 ? 1 : 0;
