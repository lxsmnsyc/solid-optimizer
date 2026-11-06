/**
 * Runs every build from `build.ts` in a browser, clicks through the app, and
 * checks that the optimized app renders the same DOM as the plain one at
 * every step.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserPage, BrowserWindow, Node } from 'happy-dom';
import { Browser } from 'happy-dom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODES = ['default', 'vendor', 'single'];

interface Step {
  readonly label: string;
  /** What to click before the snapshot. The first step clicks nothing. */
  readonly click?: string;
}

const STEPS: Step[] = [
  { label: 'open issues' },
  { label: 'all issues', click: '.filters button:nth-child(3)' },
  { label: 'issue #1 comments', click: '.issues li:nth-child(1)' },
  { label: 'issue #1 details', click: '.tabs button:nth-child(2)' },
  { label: 'star issue #2', click: '.issues li:nth-child(2) .star' },
  { label: 'issue #1 comments again', click: '.tabs button:nth-child(1)' },
  { label: 'issue #13 fails', click: '.issues li:nth-child(13)' },
  { label: 'retry issue #13', click: '.retry' },
  { label: 'issue #4 comments', click: '.issues li:nth-child(4)' },
  { label: 'closed issues', click: '.filters button:nth-child(2)' },
];

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
  const attributes = [...node.attributes]
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

async function settle(page: BrowserPage): Promise<void> {
  // The data answers on later microtasks, which `waitUntilComplete` does not wait for.
  await page.waitUntilComplete();
  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
  await page.waitUntilComplete();
}

/** Loads a build and returns the `#app` markup after each step. */
async function snapshots(dir: string): Promise<string[]> {
  const server = createServer((request, response) => {
    const file = path.join(dir, request.url === '/' ? 'index.html' : (request.url ?? ''));
    if (file.endsWith('.js')) {
      // happy-dom misses `import.meta` in some places when it compiles a module.
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
    const { document, window } = page.mainFrame;
    const result: string[] = [];
    for (const step of STEPS) {
      if (step.click) {
        document
          .querySelector(step.click)
          ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      }
      // oxlint-disable-next-line no-await-in-loop
      await settle(page);
      const app = document.getElementById('app');
      result.push(app ? normalize(app, window) : '');
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
  for (const [index, step] of STEPS.entries()) {
    const before = plain[index] ?? '';
    const after = optimized[index] ?? '';
    // Each click has to change the page, or comparing after it proves nothing.
    const changed = index === 0 ? before.includes('class="issue') : before !== plain[index - 1];
    const ok = before === after && changed;
    if (!ok) {
      failures += 1;
    }
    process.stdout.write(
      `${ok ? '✓' : '✗'} ${mode} ${step.label}${changed ? '' : ' (nothing changed)'}\n`,
    );
    if (before !== after) {
      process.stdout.write(`  plain:     ${before}\n  optimized: ${after}\n`);
    }
  }
}
process.exitCode = failures > 0 ? 1 : 0;
