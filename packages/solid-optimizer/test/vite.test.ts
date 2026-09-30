import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Element } from 'happy-dom';
import { Browser, Window } from 'happy-dom';
import type { Rollup } from 'vite';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import type { Options } from '../src/vite';
import solid from '../src/vite';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function bundle(
  fixture: string,
  options: Options = {},
  input?: { client?: string; server?: string },
  outputOptions: Rollup.OutputOptions = {},
): Promise<Rollup.OutputChunk[]> {
  const result = await build({
    root: path.join(fixtures, fixture),
    configFile: false,
    logLevel: 'silent',
    plugins: [solid(options)],
    build: {
      write: false,
      minify: false,
      modulePreload: false,
      ssr: input?.server ?? false,
      rolldownOptions: { ...(input?.client ? { input: input.client } : {}), output: outputOptions },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((output) =>
    'output' in output
      ? output.output.filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
      : [],
  );
}

/**
 * Runs a single-chunk app in a DOM and returns the mount point.
 */
async function run(chunks: Rollup.OutputChunk[]): Promise<{ app: Element; window: Window }> {
  expect(chunks).toHaveLength(1);
  const window = new Window();
  window.document.body.innerHTML = '<div id="app"></div>';
  // The runtime reads `import.meta` to resolve lazy modules, which a script cannot use.
  window.eval((chunks.at(0)?.code ?? '').replaceAll('import.meta', '({})'));
  await window.happyDOM.waitUntilComplete();
  const app = window.document.getElementById('app');
  if (!app) {
    throw new Error('no #app');
  }
  return { app, window };
}

const scratch = path.join(fixtures, '../../.scratch');

function hasRender(value: unknown): value is { render: () => string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'render' in value &&
    typeof value.render === 'function'
  );
}

/**
 * Builds a fixture to disk, serves it, and loads it in a browser.
 * Returns the `#app` markup once every script and lazy chunk has loaded.
 */
async function load(fixture: string, options: Options = {}): Promise<string> {
  const outDir = path.join(
    scratch,
    `${fixture}-${options.optimizer === false ? 'plain' : 'optimized'}`,
  );
  rmSync(outDir, { recursive: true, force: true });
  await build({
    root: path.join(fixtures, fixture),
    configFile: false,
    logLevel: 'silent',
    plugins: [solid(options)],
    build: { outDir, minify: false },
  });
  const server = createServer((request, response) => {
    const file = path.join(outDir, request.url === '/' ? 'index.html' : (request.url ?? ''));
    if (file.endsWith('.js')) {
      // happy-dom cannot compile the runtime's `import.meta.resolve`, which only lazy() fallbacks use.
      response.setHeader('content-type', 'text/javascript');
      response.end(readFileSync(file, 'utf8').replaceAll('import.meta', '({})'));
    } else {
      response.setHeader('content-type', 'text/html');
      response.end(readFileSync(file));
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('no port');
  }
  const { port } = address;
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
    return page.mainFrame.document.getElementById('app')?.innerHTML ?? '';
  } finally {
    await browser.close();
    server.close();
  }
}

describe('solid-optimizer/vite', () => {
  it('merges a client app into one template', async () => {
    const chunks = await bundle('basic');
    const code = chunks.map((chunk) => chunk.code).join('\n');
    expect(code).not.toContain('__SOLID_OPTIMIZER_KEEP__');
    expect(code.match(/template\(`/g)).toHaveLength(1);
    expect(code).toContain('<main><h1 class=title>Hello</h1><button type=button>');
  });

  it('runs a single chunk whose lazy modules the bundler wraps', async () => {
    // Without code splitting, a module behind a dynamic import is wrapped in
    // an init function, and its marker with it.
    const chunks = await bundle('split', {}, undefined, { codeSplitting: false });
    const code = chunks.map((chunk) => chunk.code).join('\n');
    expect(code).toContain('__esmMin');
    expect(code).not.toContain('__SOLID_OPTIMIZER_KEEP__');
    const { app, window } = await run(chunks);
    // A lazy page resolves after the first render.
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    await window.happyDOM.waitUntilComplete();
    expect(app.innerHTML.replaceAll(/<!--[^>]*-->/g, '')).toBe(
      '<main><section class="card"><h2>Home</h2><p>eager</p></section><section class="card"><h2>Lazy</h2><ul><li>a</li><li>b</li></ul></section></main>',
    );
  });

  it('drops lazy chunks that only a folded branch used', async () => {
    const optimized = await bundle('dead-lazy');
    const plain = await bundle('dead-lazy', { optimizer: false });
    // Folding before bundling removes the `lazy()` import from the module graph.
    expect(optimized).toHaveLength(1);
    expect(optimized.map((chunk) => chunk.code).join('\n')).not.toContain('admin tools');
    expect(plain).toHaveLength(2);
  });

  it('folds constants imported from other modules before bundling', async () => {
    for (const mode of ['auto', 'module'] as const) {
      // oxlint-disable-next-line no-await-in-loop
      const chunks = await bundle('imported-constants', { optimizer: { mode } });
      const code = chunks.map((chunk) => chunk.code).join('\n');
      // `ADMIN` is re-exported from another module, and its branch takes the lazy chunk with it.
      expect(chunks).toHaveLength(1);
      expect(code).not.toContain('admin tools');
      expect(code).toContain('<main class=dark><h1>Home');
    }
    expect(await bundle('imported-constants', { optimizer: false })).toHaveLength(2);
  });

  it('renders and updates like the unoptimized build', async () => {
    const optimized = await run(await bundle('basic'));
    const plain = await run(await bundle('basic', { optimizer: false }));
    // The optimized tree needs fewer insert markers, which are comments.
    const html = (app: Element): string => app.innerHTML.replaceAll('<!---->', '');
    expect(html(optimized.app)).toBe(html(plain.app));
    expect(html(optimized.app)).toBe(
      '<main><h1 class="title">Hello</h1><button type="button">Clicks: 1</button></main>',
    );

    for (const { app, window } of [optimized, plain]) {
      app.querySelector('button')?.click();
      // oxlint-disable-next-line no-await-in-loop
      await window.happyDOM.waitUntilComplete();
    }
    expect(html(optimized.app)).toBe(html(plain.app));
    expect(html(optimized.app)).toContain('Clicks: 2');
  });

  it('drops code only effects use from the server bundle', async () => {
    const serverCode = async (options: Options): Promise<string> => {
      const chunks = await bundle('ssr', options, { server: 'src/entry-server.tsx' });
      return chunks.map((chunk) => chunk.code).join('\n');
    };
    const optimized = await serverCode({ ssr: true });
    const plain = await serverCode({ ssr: true, optimizer: false });
    const client = (await bundle('ssr', { ssr: true }, { client: 'src/entry-client.tsx' }))
      .map((chunk) => chunk.code)
      .join('\n');
    // The effect is removed while modules are transformed, so the bundler never keeps its import.
    expect(optimized).not.toContain('client-only-analytics');
    expect(plain).toContain('client-only-analytics');
    expect(client).toContain('client-only-analytics');
  });

  it('hydrates server HTML when both builds optimize each module', async () => {
    const text = (markup: string): string => markup.replaceAll(/<!--[^>]*-->/g, '');
    const results: { markup: string; hydrated: string; claimed: boolean }[] = [];
    for (const optimizer of [undefined, false] as const) {
      const options: Options = { ssr: true, optimizer };
      // oxlint-disable-next-line no-await-in-loop
      const server = (await bundle('ssr', options, { server: 'src/entry-server.tsx' })).at(0);
      // oxlint-disable-next-line no-await-in-loop
      const client = await bundle('ssr', options, { client: 'src/entry-client.tsx' });
      const out = path.join(scratch, `ssr-${String(optimizer)}`);
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
      writeFileSync(path.join(out, 'server.mjs'), server?.code ?? '');
      // oxlint-disable-next-line no-await-in-loop
      const module: unknown = await import(pathToFileURL(path.join(out, 'server.mjs')).href);
      if (!hasRender(module)) {
        throw new Error('no render');
      }
      const markup = module.render();

      const window = new Window();
      window.document.body.innerHTML = `<div id="app">${markup}</div>`;
      const serverButton = window.document.querySelector('button');
      window.eval('window._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };');
      // The runtime reads `import.meta` to resolve lazy modules, which a script cannot use.
      const script = client.map((chunk) => chunk.code).join('\n');
      window.eval(script.replaceAll('import.meta', '({})'));
      // oxlint-disable-next-line no-await-in-loop
      await window.happyDOM.waitUntilComplete();
      const button = window.document.querySelector('button');
      button?.click();
      // oxlint-disable-next-line no-await-in-loop
      await window.happyDOM.waitUntilComplete();
      results.push({
        markup,
        hydrated: text(window.document.getElementById('app')?.innerHTML ?? ''),
        // Hydration claims the server's nodes instead of rendering new ones.
        claimed: serverButton !== null && serverButton === button,
      });
    }
    const optimized = results.at(0);
    const plain = results.at(1);
    if (!optimized || !plain) {
      throw new Error('missing result');
    }
    expect(optimized.claimed).toBe(true);
    expect(plain.claimed).toBe(true);
    expect(optimized.hydrated).toBe(
      '<main data-hk="00"><h1 class="title">Hello</h1><button type="button">Clicks: 2</button></main>',
    );
    expect(optimized.hydrated.replaceAll(/ data-hk="[^"]*"/g, '')).toBe(
      plain.hydrated.replaceAll(/ data-hk="[^"]*"/g, ''),
    );
    // The merged tree needs one hydration key instead of one per component.
    expect(optimized.markup.match(/data-hk=/g)).toHaveLength(1);
    expect(plain.markup.match(/data-hk=/g)).toHaveLength(3);
  });

  it('runs code-split chunks that share the runtime', async () => {
    const text = (markup: string): string => markup.replaceAll(/<!--[^>]*-->/g, '');
    const optimized = text(await load('split'));
    const plain = text(await load('split', { optimizer: false }));
    expect(optimized).toBe(plain);
    expect(optimized).toBe(
      '<main><section class="card"><h2>Home</h2><p>eager</p></section><section class="card"><h2>Lazy</h2><ul><li>a</li><li>b</li></ul></section></main>',
    );
  });
});
