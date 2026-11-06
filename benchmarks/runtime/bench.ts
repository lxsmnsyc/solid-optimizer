/**
 * Measures what the optimizer changes at runtime: client creation, server
 * rendering, and hydration. Each app in `src/<app>` is built once without the
 * optimizer and once with it.
 *
 * - `demo` is the demo with every page rendered at once.
 * - `hackernews` is Hacker News's story lists and comments, from its fixtures.
 *
 * Counts are exact, so any difference in them is real. Timings run the two
 * builds in turns, so drift in machine load hits both, and a change is only
 * marked as real when it is larger than 3 times the noise, the larger median
 * absolute deviation of the two sides.
 *
 * Usage:
 *
 * - `node bench.ts` builds, measures, and writes `results.md` and
 *   `results.json`.
 * - `--app <name>` picks the app. Defaults to `demo`. Another app writes
 *   `results-<app>.md` and `results-<app>.json`.
 * - `--runs <n>` takes n samples of each timing. Defaults to 15.
 * - `--json <file>` picks the path of the raw results. The website reads the
 *   demo's.
 * - `--markdown <file>` picks the report's path. `-` prints it.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import type { BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import solid from 'solid-optimizer/vite';
import { build } from 'vite';
import type { DomCounts, HydrationCounts } from './page.ts';
import {
  countClient,
  countHydration,
  disposeHeap,
  instrument,
  mountHeap,
  prepareHeap,
  timeMount,
  timeOnce,
} from './page.ts';
import type { Results, Row, Samples, Variant } from './report.ts';
import { APPS, VARIANTS, isApp, summarize, writeReport } from './report.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    app: { type: 'string', default: 'demo' },
    runs: { type: 'string', default: '15' },
    json: { type: 'string' },
    markdown: { type: 'string' },
  },
});
if (!isApp(args.app)) {
  throw new Error(`--app must be one of ${Object.keys(APPS).join(', ')}`);
}
const APP = args.app;
// The demo keeps the plain names, which the website reads.
const SUFFIX = APP === 'demo' ? '' : `-${APP}`;
const JSON_PATH = args.json ?? path.join(HERE, `results${SUFFIX}.json`);
const MARKDOWN_PATH = args.markdown ?? path.join(HERE, `results${SUFFIX}.md`);
const DIST = path.join(HERE, 'dist', APP);
const RUNS = Number(args.runs);
const WARMUP = 3;

/**
 * Builds the client, hydrating client, and server bundles of one variant into
 * `dist/<variant>`. Each is one minified chunk.
 */
async function buildVariant(variant: Variant): Promise<void> {
  const optimizer = variant === 'plain' ? false : undefined;
  const targets = [
    { name: 'client', entry: `src/${APP}/client.tsx`, ssr: false, server: false },
    { name: 'hydrate', entry: `src/${APP}/hydrate.tsx`, ssr: true, server: false },
    { name: 'server', entry: `src/${APP}/server.tsx`, ssr: true, server: true },
  ];
  for (const target of targets) {
    // oxlint-disable-next-line no-await-in-loop
    await build({
      root: HERE,
      configFile: false,
      logLevel: 'warn',
      plugins: [solid({ ssr: target.ssr, optimizer })],
      build: {
        outDir: path.join(DIST, variant, target.name),
        emptyOutDir: true,
        minify: true,
        modulePreload: false,
        ssr: target.server ? target.entry : false,
        rolldownOptions: {
          ...(target.server ? {} : { input: path.join(HERE, target.entry) }),
          output: {
            codeSplitting: false,
            entryFileNames: target.server ? 'server.mjs' : `${target.name}.js`,
          },
        },
      },
    });
  }
}

interface ServerModule {
  render: () => string;
  hydrationScript: () => string;
}

function isServerModule(value: unknown): value is ServerModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'render' in value &&
    typeof value.render === 'function' &&
    'hydrationScript' in value &&
    typeof value.hydrationScript === 'function'
  );
}

async function loadServer(variant: Variant): Promise<ServerModule> {
  const file = path.join(DIST, variant, 'server', 'server.mjs');
  const module: unknown = await import(pathToFileURL(file).href);
  if (!isServerModule(module)) {
    throw new Error(`${file} does not export render() and hydrationScript()`);
  }
  return module;
}

/** The exact counts of what one server render writes. */
interface ServerCounts {
  htmlBytes: number;
  htmlGzip: number;
  hydrationKeys: number;
  comments: number;
}

function countServer(html: string): ServerCounts {
  return {
    htmlBytes: Buffer.byteLength(html),
    htmlGzip: gzipSync(html).byteLength,
    hydrationKeys: (html.match(/\s_hk=/g) ?? []).length,
    comments: (html.match(/<!--/g) ?? []).length,
  };
}

function isVariant(value: string | null): value is Variant {
  return value === 'plain' || value === 'optimized';
}

/**
 * Serves `dist` and the two pages. The headers make the page cross-origin
 * isolated, which gives `performance.now()` a 5 µs resolution instead of
 * 100 µs.
 */
async function serve(servers: Record<Variant, ServerModule>): Promise<{
  url: string;
  close: () => void;
}> {
  const server = createServer((request, response) => {
    response.setHeader('cross-origin-opener-policy', 'same-origin');
    response.setHeader('cross-origin-embedder-policy', 'require-corp');
    const url = new URL(request.url ?? '/', 'http://localhost');
    const variant = url.searchParams.get('variant');
    const head = '<!doctype html><html><head><meta charset="utf-8">';
    if (url.pathname === '/client.html' && isVariant(variant)) {
      response.setHeader('content-type', 'text/html');
      response.end(
        `${head}</head><body><div id="app"></div>` +
          `<script type="module" src="/${variant}/client/client.js"></script></body></html>`,
      );
      return;
    }
    if (url.pathname === '/hydrate.html' && isVariant(variant)) {
      const module = servers[variant];
      response.setHeader('content-type', 'text/html');
      response.end(
        `${head}${module.hydrationScript()}</head><body><div id="app">${module.render()}</div>` +
          `<script type="module" src="/${variant}/hydrate/hydrate.js"></script></body></html>`,
      );
      return;
    }
    try {
      const body = readFileSync(path.join(DIST, path.normalize(url.pathname)));
      response.setHeader('content-type', 'text/javascript');
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the server has no port');
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () => {
      server.close();
    },
  };
}

async function open(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => 'bench' in window);
  return page;
}

/**
 * Bytes of JavaScript heap that one mounted app holds, averaged over many
 * copies. The heap is read through the DevTools protocol after a full
 * garbage collection, since `performance.memory` is rounded in headless mode.
 */
async function measureHeap(page: Page, copies: number): Promise<number> {
  const session = await page.context().newCDPSession(page);
  async function readHeap(): Promise<number> {
    await session.send('HeapProfiler.collectGarbage');
    const usage = await session.send('Runtime.getHeapUsage');
    return usage.usedSize;
  }
  await page.evaluate(prepareHeap, copies);
  const before = await readHeap();
  await page.evaluate(mountHeap);
  const after = await readHeap();
  await page.evaluate(disposeHeap);
  await session.detach();
  return (after - before) / copies;
}

/** Microseconds of one mount or hydration, in a page that has run nothing before it. */
async function timeFresh(
  context: BrowserContext,
  url: string,
  kind: 'mount' | 'hydrate',
): Promise<number> {
  const page = await open(context, url);
  const result = await page.evaluate(timeOnce, kind);
  await page.close();
  return result;
}

function timeServer(variant: Variant, iterations: number): number {
  const file = path.join(DIST, variant, 'server', 'server.mjs');
  const result = spawnSync(
    process.execPath,
    [path.join(HERE, 'ssr-run.ts'), file, String(iterations)],
    { encoding: 'utf8' },
  );
  const match = /us\/op: ([\d.]+)/.exec(result.stdout);
  if (result.status !== 0 || !match) {
    throw new Error(`ssr-run failed: ${result.stderr}`);
  }
  return Number(match[1]);
}

/** Takes `RUNS` samples of a timing per variant, in turns, after a warmup. */
async function sample(
  samples: Samples,
  name: string,
  measure: (variant: Variant) => Promise<number> | number,
): Promise<void> {
  const entry: Record<Variant, number[]> = { plain: [], optimized: [] };
  samples[name] = entry;
  for (let run = 0; run < WARMUP + RUNS; run += 1) {
    // Alternate which side goes first, so neither always runs on a warmer machine.
    const order = run % 2 === 0 ? VARIANTS : VARIANTS.toReversed();
    for (const variant of order) {
      // oxlint-disable-next-line no-await-in-loop
      const value = await measure(variant);
      if (run >= WARMUP) {
        entry[variant].push(value);
      }
    }
  }
}

/** Checks that both builds render the same app, and hydrate without changes. */
function check(
  client: Record<Variant, DomCounts>,
  hydration: Record<Variant, HydrationCounts>,
): void {
  const problems: string[] = [];
  if (client.plain.markup !== client.optimized.markup) {
    problems.push('The two client builds render different markup.');
  }
  for (const variant of VARIANTS) {
    const counts = hydration[variant];
    if (counts.markup !== counts.serverMarkup) {
      problems.push(`Hydrating the ${variant} build changed the server's markup.`);
    }
    if (counts.markup !== client[variant].markup) {
      problems.push(`The ${variant} build hydrates to other markup than it renders.`);
    }
    if (!counts.interactive) {
      problems.push(`The ${variant} build does not respond to a click after hydration.`);
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}

function pair(label: string, plain: number, optimized: number): Row {
  return { label, plain, optimized };
}

function gzipScript(variant: Variant, name: string): number {
  return gzipSync(readFileSync(path.join(DIST, variant, name, `${name}.js`))).byteLength;
}

// Build both variants, and count what each server render writes.
for (const variant of VARIANTS) {
  // oxlint-disable-next-line no-await-in-loop
  await buildVariant(variant);
}
const servers: Record<Variant, ServerModule> = {
  plain: await loadServer('plain'),
  optimized: await loadServer('optimized'),
};
const serverCounts: Record<Variant, ServerCounts> = {
  plain: countServer(servers.plain.render()),
  optimized: countServer(servers.optimized.render()),
};

const { url, close } = await serve(servers);
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  await context.addInitScript(instrument);

  // Count what the client creates and what hydration changes.
  const clientCounts: Partial<Record<Variant, DomCounts>> = {};
  const hydrationCounts: Partial<Record<Variant, HydrationCounts>> = {};
  for (const variant of VARIANTS) {
    // oxlint-disable-next-line no-await-in-loop
    const clientPage = await open(context, `${url}/client.html?variant=${variant}`);
    // oxlint-disable-next-line no-await-in-loop
    clientCounts[variant] = await clientPage.evaluate(countClient);
    // oxlint-disable-next-line no-await-in-loop
    await clientPage.close();
    // oxlint-disable-next-line no-await-in-loop
    const hydratePage = await open(context, `${url}/hydrate.html?variant=${variant}`);
    // oxlint-disable-next-line no-await-in-loop
    hydrationCounts[variant] = await hydratePage.evaluate(countHydration);
    // oxlint-disable-next-line no-await-in-loop
    await hydratePage.close();
  }
  const { plain: clientPlain, optimized: clientOptimized } = clientCounts;
  const { plain: hydrationPlain, optimized: hydrationOptimized } = hydrationCounts;
  if (!clientPlain || !clientOptimized || !hydrationPlain || !hydrationOptimized) {
    throw new Error('a build was not counted');
  }
  const client = { plain: clientPlain, optimized: clientOptimized };
  const hydration = { plain: hydrationPlain, optimized: hydrationOptimized };
  check(client, hydration);

  // Time each side in turns. Warm timings reuse one page per side.
  const samples: Samples = {};
  const warm: Record<Variant, Page> = {
    plain: await open(context, `${url}/client.html?variant=plain`),
    optimized: await open(context, `${url}/client.html?variant=optimized`),
  };
  const disposals: Record<Variant, number[]> = { plain: [], optimized: [] };
  await sample(samples, 'mount', async (variant) => {
    const result = await warm[variant].evaluate(timeMount, 200);
    disposals[variant].push(result.dispose);
    return result.mount;
  });
  samples.dispose = {
    plain: disposals.plain.slice(WARMUP),
    optimized: disposals.optimized.slice(WARMUP),
  };
  await sample(samples, 'heap', async (variant) => measureHeap(warm[variant], 200));
  await warm.plain.close();
  await warm.optimized.close();
  await sample(samples, 'coldMount', async (variant) =>
    timeFresh(context, `${url}/client.html?variant=${variant}`, 'mount'),
  );
  await sample(samples, 'hydrate', async (variant) =>
    timeFresh(context, `${url}/hydrate.html?variant=${variant}`, 'hydrate'),
  );
  await sample(samples, 'ssr', (variant) => timeServer(variant, 2000));

  function countPair<T>(source: Record<Variant, T>, key: keyof T & string, label: string): Row {
    const plain = source.plain[key];
    const optimized = source.optimized[key];
    if (typeof plain !== 'number' || typeof optimized !== 'number') {
      throw new Error(`${key} is not a count`);
    }
    return pair(label, plain, optimized);
  }

  const results: Results = {
    app: APP,
    date: new Date().toISOString().slice(0, 10),
    node: process.version,
    cpu: cpus()[0]?.model ?? 'unknown CPU',
    browser: browser.version(),
    runs: RUNS,
    warmup: WARMUP,
    client: {
      script: pair(
        'Script (gzip, B)',
        gzipScript('plain', 'client'),
        gzipScript('optimized', 'client'),
      ),
      templatesCreated: countPair(client, 'templatesCreated', 'Templates created'),
      nodesCloned: countPair(client, 'nodesCloned', 'Templates cloned'),
      elements: countPair(client, 'elements', 'Elements'),
      texts: countPair(client, 'texts', 'Text nodes'),
      comments: countPair(client, 'comments', 'Comment markers'),
    },
    server: {
      htmlBytes: countPair(serverCounts, 'htmlBytes', 'HTML (B)'),
      htmlGzip: countPair(serverCounts, 'htmlGzip', 'HTML (gzip, B)'),
      hydrationKeys: countPair(serverCounts, 'hydrationKeys', 'Hydration keys (`_hk`)'),
      comments: countPair(serverCounts, 'comments', 'Comment markers'),
    },
    hydration: {
      script: pair(
        'Script (gzip, B)',
        gzipScript('plain', 'hydrate'),
        gzipScript('optimized', 'hydrate'),
      ),
      nodesCreated: countPair(hydration, 'nodesCreated', 'Nodes created'),
      nodesRemoved: countPair(hydration, 'nodesRemoved', 'Server nodes removed'),
      nodesCloned: countPair(hydration, 'nodesCloned', 'Templates cloned'),
    },
    timings: summarize(samples),
  };
  const report = writeReport(results);
  writeFileSync(JSON_PATH, `${JSON.stringify(results, null, 2)}\n`);
  if (MARKDOWN_PATH === '-') {
    process.stdout.write(report);
  } else {
    writeFileSync(MARKDOWN_PATH, report);
  }
} finally {
  await browser.close();
  close();
}
