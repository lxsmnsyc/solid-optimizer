/**
 * Runs every build from `build.ts` in a browser and checks that the optimized
 * app renders the same DOM as the plain one, before and after each click.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow, Node } from 'happy-dom';
import { Browser } from 'happy-dom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODES = ['default', 'vendor', 'single'];
const CLICKS = ['Save', 'Save', 'Edit'];

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
  let children = '';
  for (const child of node.childNodes) {
    children += normalize(child, window);
  }
  const tag = node.tagName.toLowerCase();
  return `<${tag}${attributes}>${children}</${tag}>`;
}

/**
 * Loads a build and returns the `#app` markup at the start and after each click.
 */
async function snapshots(dir: string): Promise<string[]> {
  const server = createServer((request, response) => {
    const file = path.join(dir, request.url === '/' ? 'index.html' : (request.url ?? ''));
    if (file.endsWith('.js')) {
      // happy-dom misses `import.meta` in some places when it compiles a
      // module, so it is filled in here.
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
    const { document, window } = page.mainFrame;
    const app = (): string => {
      const root = document.getElementById('app');
      return root ? normalize(root, window) : '';
    };
    const result = [app()];
    for (const label of CLICKS) {
      const button = [...document.querySelectorAll('button')].find(
        (element) => element.textContent.trim() === label,
      );
      button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      // oxlint-disable-next-line no-await-in-loop
      await page.waitUntilComplete();
      result.push(app());
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
  for (const [index, markup] of plain.entries()) {
    const step = index === 0 ? 'start' : `after ${CLICKS[index - 1] ?? ''} (${String(index)})`;
    const same = markup === optimized[index];
    const loaded = markup.includes('<h2>Settings</h2>');
    if (!same || !loaded) {
      failures += 1;
    }
    process.stdout.write(
      `${same && loaded ? '✓' : '✗'} ${mode} ${step}${loaded ? '' : ' (app did not load)'}\n`,
    );
    if (!same) {
      process.stdout.write(`  plain:     ${markup}\n  optimized: ${optimized[index] ?? ''}\n`);
    }
  }
  // The clicks have to change something, or the comparison proves nothing.
  if (new Set(plain).size < 3) {
    failures += 1;
    process.stdout.write(`✗ ${mode} the clicks changed nothing\n`);
  }
}
process.exitCode = failures > 0 ? 1 : 0;
