/**
 * Runs an app built with and without the optimizer, and records what each renders.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import type { Rollup } from 'vite';
import { build } from 'vite';
import solid from '../src/vite';

const cases = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.scratch/cases');

const INDEX_HTML =
  '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.tsx"></script></body></html>';

export interface Run {
  /** The `#app` markup after the first render and after each click, without comments. */
  readonly snapshots: string[];
  /** The bundled code. */
  readonly code: string;
}

async function buildApp(root: string, optimize: boolean): Promise<string> {
  const result = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [solid({ optimizer: optimize ? {} : false })],
    build: { write: false, minify: false, modulePreload: false },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunks = outputs.flatMap((output) =>
    'output' in output
      ? output.output.filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
      : [],
  );
  if (chunks.length !== 1) {
    throw new Error(`expected one chunk, got ${String(chunks.length)}`);
  }
  return chunks.at(0)?.code ?? '';
}

async function runApp(code: string, clicks: readonly string[]): Promise<string[]> {
  const window = new Window();
  window.document.body.innerHTML = '<div id="app"></div>';
  // happy-dom empties an element for `textContent = 0` instead of writing "0",
  // which Solid does for a number that is an element's only child.
  window.eval(`for (const type of [Node, Element]) {
    const { get, set } = Object.getOwnPropertyDescriptor(type.prototype, 'textContent');
    Object.defineProperty(type.prototype, 'textContent', {
      get,
      set(value) { set.call(this, typeof value === 'number' ? String(value) : value); },
      configurable: true,
    });
  }`);
  // The runtime reads `import.meta` to resolve lazy modules, which a script cannot use.
  window.eval(code.replaceAll('import.meta', '({})'));
  await window.happyDOM.waitUntilComplete();
  const app = window.document.getElementById('app');
  if (!app) {
    throw new Error('no #app');
  }
  const snapshot = (): string => app.innerHTML.replaceAll(/<!--[^>]*-->/g, '');
  const snapshots = [snapshot()];
  for (const selector of clicks) {
    const target = window.document.querySelector(selector);
    if (!target) {
      throw new Error(`nothing matches ${selector}`);
    }
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    // oxlint-disable-next-line no-await-in-loop
    await window.happyDOM.waitUntilComplete();
    snapshots.push(snapshot());
  }
  window.close();
  return snapshots;
}

/**
 * Builds `files` into an app with and without the optimizer, runs both, and
 * clicks each selector in turn.
 */
export async function runBoth(
  name: string,
  files: Record<string, string>,
  clicks: readonly string[] = [],
): Promise<{ optimized: Run; plain: Run }> {
  const root = path.join(cases, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'index.html'), INDEX_HTML);
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(path.join(root, 'src', file), content);
  }
  const optimizedCode = await buildApp(root, true);
  const plainCode = await buildApp(root, false);
  return {
    optimized: { code: optimizedCode, snapshots: await runApp(optimizedCode, clicks) },
    plain: { code: plainCode, snapshots: await runApp(plainCode, clicks) },
  };
}

/**
 * The code of the app's own modules in a bundle, without the runtime.
 */
export function appCode(code: string): string {
  const start = /^\/\/#region (?!.*node_modules)(?!\0).*\/src\//m.exec(code);
  return start ? code.slice(start.index) : code;
}
