/**
 * Runs every build from `build.ts` in a browser and checks that the optimized
 * app renders the same DOM as the plain one, on each route.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserPage, BrowserWindow, Element, Node } from 'happy-dom';
import { Browser } from 'happy-dom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODES = ['default', 'vendor', 'single'];

interface Route {
  readonly path: string;
  /** An element that shows the route has rendered. */
  readonly ready: string;
  /**
   * An element to click once it has, to check updates too: the first match
   * of `selector` that contains `text`, or the one at `index`.
   */
  readonly click?: { readonly selector: string; readonly text?: string; readonly index?: number };
}

const ROUTES: Route[] = [
  { path: '/', ready: 'main h3', click: { selector: 'input[type=checkbox]' } },
  { path: '/dashboard', ready: '[role=tablist]', click: { selector: '[aria-haspopup]' } },
  { path: '/mail', ready: 'button.text-left', click: { selector: 'button.text-left', index: 1 } },
  { path: '/tasks', ready: 'table', click: { selector: 'button', text: 'Go to next page' } },
  {
    path: '/authentication',
    ready: 'form',
    click: { selector: 'button[type=submit]' },
  },
];

/** The first element matching `click`. */
function clickTarget(page: BrowserPage, click: NonNullable<Route['click']>): Element | undefined {
  const matches = Array.from(page.mainFrame.document.querySelectorAll(click.selector)).filter(
    (element) => element.textContent.includes(click.text ?? ''),
  );
  return matches.at(click.index ?? 0);
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
 * Waits for `selector` to match. Timers the app keeps running would keep
 * `waitUntilComplete` from returning.
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
    const file = path.join(dir, url.split('?')[0] ?? '');
    if (url.endsWith('.js') && existsSync(file)) {
      const origin = `http://${request.headers.host ?? ''}`;
      response.setHeader('content-type', 'text/javascript');
      response.end(
        readFileSync(file, 'utf8').replaceAll(
          /import\.meta/g,
          `({ url: ${JSON.stringify(origin + url)} })`,
        ),
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
        // Kobalte's triggers act on pointer events, and plain elements on clicks.
        const target = clickTarget(page, route.click);
        for (const type of ['pointerdown', 'pointerup']) {
          target?.dispatchEvent(
            new window.PointerEvent(type, { bubbles: true, button: 0, pointerType: 'mouse' }),
          );
        }
        target?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
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
