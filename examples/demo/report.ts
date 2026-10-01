/**
 * Compares the builds from `build.ts`: chunk sizes, templates, and which
 * components each chunk still calls instead of inlining.
 *
 * Sizes are measured after minifying and gzipping each chunk, so they match
 * what a production build ships. The builds themselves stay readable.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { minifySync } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODES = ['default', 'vendor', 'single'] as const;
type Mode = (typeof MODES)[number];

interface Chunk {
  /** The chunk name without its hash, like `Dashboard`. */
  readonly name: string;
  readonly minified: number;
  readonly gzipped: number;
  readonly templates: number;
  /** The components this chunk still calls, by name. */
  readonly calls: Map<string, number>;
  /** The components this chunk still defines. */
  readonly defines: Set<string>;
}

function readChunks(mode: Mode, variant: 'optimized' | 'plain'): Chunk[] {
  const dir = path.join(HERE, 'dist', mode, variant, 'assets');
  return readdirSync(dir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => {
      const code = readFileSync(path.join(dir, file), 'utf8');
      const minified = minifySync(file, code, { module: true }).code;
      const calls = new Map<string, number>();
      for (const match of code.matchAll(/createComponent\(([A-Z][\w$]*)/g)) {
        const component = (match.at(1) ?? '').replace(/\$\d+$/, '');
        calls.set(component, (calls.get(component) ?? 0) + 1);
      }
      const defines = new Set<string>();
      for (const region of code.split('//#region ').filter((part) => part.startsWith('src/'))) {
        for (const match of region.matchAll(/^function ([A-Z][\w$]*)\(/gm)) {
          defines.add(match.at(1) ?? '');
        }
      }
      return {
        name: file.replace(/-[\w-]{8}\.js$/, ''),
        minified: Buffer.byteLength(minified),
        gzipped: gzipSync(minified).byteLength,
        templates: code.match(/template\(`/g)?.length ?? 0,
        calls,
        defines,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

function change(before: number, after: number): string {
  const delta = after - before;
  const percent = before === 0 ? 0 : (delta / before) * 100;
  return `${delta > 0 ? '+' : ''}${String(delta)} B (${percent.toFixed(1)}%)`;
}

function pad(text: string, width: number): string {
  return text.padEnd(width);
}

function callList(calls: Map<string, number>): string {
  return (
    [...calls].map(([name, count]) => (count > 1 ? `${name}×${String(count)}` : name)).join(', ') ||
    '-'
  );
}

/**
 * Components that cannot be inlined, whatever the chunking:
 *
 * - Solid's built-ins, like `<Show>` and `<For>`, are runtime components,
 *   and `Comp` is the runtime calling a component it was given.
 * - `App` is rendered from a `render()` callback, where its statements cannot move.
 * - `Home` gets statements from `Counter`, and renders in a `<Switch>` fallback.
 * - The lazy pages are `lazy()` wrappers, not component functions.
 */
const NEVER_INLINED = new Set([
  // The runtime's own `createComponent(Comp, props)`.
  'Comp',
  'For',
  'Show',
  'Switch',
  'Match',
  'Loading',
  'Errored',
  'Reveal',
  'Portal',
  'Repeat',
  'Dynamic',
  'App',
  'Home',
  'About',
  'Dashboard',
  'Settings',
  'Chart',
]);

/**
 * Components each chunk may still call because they live in another chunk.
 * Components are inlined across modules before bundling now, so none are
 * expected, but a chunk that calls these is not a failure.
 */
const CROSS_CHUNK: Record<Mode, Record<string, readonly string[]>> = {
  default: {
    About: ['Card'],
    Dashboard: ['Card', 'Table'],
    Settings: ['Card', 'Avatar', 'Table', 'Button'],
  },
  vendor: {
    About: ['Card'],
    Dashboard: ['Card', 'Table'],
    Settings: ['Card', 'Avatar', 'Table', 'Button'],
  },
  // One chunk holds every component, so none of them stays for this reason.
  single: {},
};

/** Chunks with only Solid's runtime, which has no app components. */
const RUNTIME_CHUNKS = new Set(['web', 'vendor']);

let failures = 0;
const totals: string[] = [];

for (const mode of MODES) {
  const plain = readChunks(mode, 'plain');
  const optimized = readChunks(mode, 'optimized');
  const width = Math.max(...[...plain, ...optimized].map((chunk) => chunk.name.length), 5) + 2;

  process.stdout.write(`\n## ${mode}\n\n`);
  process.stdout.write(
    `${pad('chunk', width)}${pad('plain (min+gz)', 16)}${pad('optimized', 12)}${pad('change', 20)}templates   component calls left\n`,
  );
  // A chunk can exist in only one build, since inlining changes how Rolldown splits.
  const names = [...new Set([...plain, ...optimized].map((chunk) => chunk.name))].sort();
  const plainTotal = plain.reduce((sum, chunk) => sum + chunk.gzipped, 0);
  const optimizedTotal = optimized.reduce((sum, chunk) => sum + chunk.gzipped, 0);
  for (const name of names) {
    const before = plain.find((other) => other.name === name);
    const chunk = optimized.find((other) => other.name === name);
    process.stdout.write(
      `${pad(name, width)}${pad(before ? kb(before.gzipped) : '-', 16)}${pad(chunk ? kb(chunk.gzipped) : '-', 12)}${pad(change(before?.gzipped ?? 0, chunk?.gzipped ?? 0), 20)}${pad(`${String(before?.templates ?? 0)} → ${String(chunk?.templates ?? 0)}`, 12)}${chunk ? callList(chunk.calls) : '-'}\n`,
    );

    if (chunk && !RUNTIME_CHUNKS.has(chunk.name)) {
      const allowed = CROSS_CHUNK[mode][chunk.name] ?? [];
      const unexpected = [...chunk.calls.keys()].filter(
        (call) => !NEVER_INLINED.has(call) && !allowed.includes(call),
      );
      if (unexpected.length > 0) {
        failures += 1;
        process.stdout.write(`${pad('', width)}✗ should have inlined: ${unexpected.join(', ')}\n`);
      }
    }
  }
  const minPlain = plain.reduce((sum, chunk) => sum + chunk.minified, 0);
  const minOptimized = optimized.reduce((sum, chunk) => sum + chunk.minified, 0);
  process.stdout.write(
    `${pad('total', width)}${pad(kb(plainTotal), 16)}${pad(kb(optimizedTotal), 12)}${change(plainTotal, optimizedTotal)}\n`,
  );
  totals.push(
    `${pad(mode, 9)} min ${kb(minPlain)} → ${kb(minOptimized)} (${change(minPlain, minOptimized)}), gzip ${kb(plainTotal)} → ${kb(optimizedTotal)} (${change(plainTotal, optimizedTotal)})`,
  );
}

process.stdout.write(`\n## Totals\n\n${totals.join('\n')}\n`);
if (failures > 0) {
  process.stdout.write(
    `\n${String(failures)} chunk(s) still call components they should have inlined.\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write('\nEvery chunk inlines what it can reach.\n');
}
