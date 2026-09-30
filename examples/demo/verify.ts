/**
 * Runs every build from `build.ts` in a browser and checks that the optimized
 * app renders the same DOM as the plain one, page by page.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow, Node } from 'happy-dom';
import { Browser } from 'happy-dom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODES = ['default', 'vendor', 'single'];
const PAGES = ['Home', 'About', 'Dashboard', 'Settings'];

/**
 * The markup of a node with its attributes sorted and comments left out. The
 * optimized build can move an attribute into a template, which changes the
 * order attributes are set in but not what the element has.
 */
function normalize(node: Node, window: BrowserWindow): string {
  if (node instanceof window.Text) {
    return node.textContent;
  }
  if (!(node instanceof window.Element)) {
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

/**
 * Loads a build and returns the `#app` markup on each page, without comments.
 */
async function snapshots(dir: string): Promise<string[]> {
  const server = createServer((request, response) => {
    const file = path.join(dir, request.url === '/' ? 'index.html' : (request.url ?? ''));
    if (file.endsWith('.js')) {
      // happy-dom misses `import.meta` in some places when it compiles a
      // module, so it is filled in here: the module's own URL, and no
      // `resolve`, which the runtime checks for before calling it.
      const url = `http://${request.headers.host ?? ''}${request.url ?? ''}`;
      response.setHeader('content-type', 'text/javascript');
      response.end(
        readFileSync(file, 'utf8').replaceAll(
          /import\.meta/g,
          `({ url: ${JSON.stringify(url)}, resolve: undefined })`,
        ),
      );
    } else {
      response.setHeader('content-type', 'text/html');
      response.end(readFileSync(file));
    }
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
    },
  });
  try {
    const page = browser.newPage();
    await page.goto(`http://localhost:${String(port)}/`);
    await page.waitUntilComplete();
    const { document } = page.mainFrame;
    const result: string[] = [];
    for (const name of PAGES) {
      const link = [...document.querySelectorAll('nav button')].find(
        (button) => button.textContent.trim() === name,
      );
      link?.dispatchEvent(new page.mainFrame.window.MouseEvent('click', { bubbles: true }));
      // A lazy page loads over the network, which `waitUntilComplete` does not
      // wait for, and Solid keeps the last page up until the new one is ready.
      for (let attempt = 0; attempt < 50; attempt += 1) {
        // oxlint-disable-next-line no-await-in-loop
        await page.waitUntilComplete();
        if (document.querySelector('section.card h2')?.textContent === name) {
          break;
        }
        // oxlint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
      }
      const app = document.getElementById('app');
      result.push(app ? normalize(app, page.mainFrame.window) : '');
    }
    return result;
  } finally {
    await browser.close();
    server.close();
  }
}

let failures = 0;
for (const mode of MODES) {
  // oxlint-disable-next-line no-await-in-loop
  const plain = await snapshots(path.join(HERE, 'dist', mode, 'plain'));
  // oxlint-disable-next-line no-await-in-loop
  const optimized = await snapshots(path.join(HERE, 'dist', mode, 'optimized'));
  for (const [index, name] of PAGES.entries()) {
    const same = plain[index] === optimized[index];
    const loaded = (plain[index] ?? '').includes(`<h2>${name}</h2>`);
    if (!same || !loaded) {
      failures += 1;
    }
    process.stdout.write(
      `${same && loaded ? '✓' : '✗'} ${mode} ${name}${loaded ? '' : ' (page did not load)'}\n`,
    );
    if (!same) {
      process.stdout.write(
        `  plain:     ${plain[index] ?? ''}\n  optimized: ${optimized[index] ?? ''}\n`,
      );
    }
  }
}
process.exitCode = failures > 0 ? 1 : 0;
