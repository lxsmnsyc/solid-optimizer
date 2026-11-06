/**
 * Compares the builds from `build.ts`: the size of each chunk, its templates,
 * and the components it still calls instead of inlining.
 *
 * Sizes are measured after minifying and gzipping each chunk, so they match
 * what a production build ships. The builds themselves stay readable.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { minifySync } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODES = ['default', 'vendor', 'single'] as const;

interface Chunk {
  /** The module the chunk comes from, or its name when it is shared. */
  readonly name: string;
  readonly gzipped: number;
  readonly templates: number;
  /** The components this chunk still calls, by name. */
  readonly calls: Map<string, number>;
}

interface ManifestEntry {
  file: string;
  src?: string;
  name?: string;
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  return (
    typeof value === 'object' && value !== null && 'file' in value && typeof value.file === 'string'
  );
}

function readChunks(mode: string, variant: 'optimized' | 'plain'): Chunk[] {
  const dir = path.join(HERE, 'dist', mode, variant);
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(dir, '.vite', 'manifest.json'), 'utf8'),
  );
  const entries = typeof manifest === 'object' && manifest ? Object.values(manifest) : [];
  return entries
    .filter((entry): entry is ManifestEntry => isManifestEntry(entry) && entry.file.endsWith('.js'))
    .map((entry) => {
      const code = readFileSync(path.join(dir, entry.file), 'utf8');
      const minified = minifySync(entry.file, code, { module: true }).code;
      const calls = new Map<string, number>();
      for (const match of code.matchAll(/createComponent\(([A-Z][\w$]*)/g)) {
        const component = (match.at(1) ?? '').replace(/\$\d+$/, '');
        calls.set(component, (calls.get(component) ?? 0) + 1);
      }
      return {
        name: (entry.src ?? entry.name ?? entry.file).replace(/^src\//, ''),
        gzipped: gzipSync(minified).byteLength,
        templates: code.match(/template\(`/g)?.length ?? 0,
        calls,
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

function callList(calls: ReadonlyMap<string, number>): string {
  return (
    [...calls].map(([name, count]) => (count > 1 ? `${name}×${String(count)}` : name)).join(', ') ||
    '-'
  );
}

const totals: string[] = [];
for (const mode of MODES) {
  const plain = readChunks(mode, 'plain');
  const optimized = readChunks(mode, 'optimized');
  // A chunk can exist in only one build, since inlining changes how Rolldown splits.
  const names = [...new Set([...plain, ...optimized].map((chunk) => chunk.name))].sort();
  const width = Math.max(...names.map((name) => name.length), 5) + 2;
  process.stdout.write(`\n## ${mode}\n\n`);
  process.stdout.write(
    `${'chunk'.padEnd(width)}${'plain (min+gz)'.padEnd(16)}${'optimized'.padEnd(12)}${'change'.padEnd(20)}${'templates'.padEnd(12)}component calls left\n`,
  );
  for (const name of names) {
    const before = plain.find((chunk) => chunk.name === name);
    const after = optimized.find((chunk) => chunk.name === name);
    process.stdout.write(
      `${name.padEnd(width)}${(before ? kb(before.gzipped) : '-').padEnd(16)}${(after ? kb(after.gzipped) : '-').padEnd(12)}${change(before?.gzipped ?? 0, after?.gzipped ?? 0).padEnd(20)}${`${String(before?.templates ?? 0)} → ${String(after?.templates ?? 0)}`.padEnd(12)}${after ? callList(after.calls) : '-'}\n`,
    );
  }
  const plainTotal = plain.reduce((sum, chunk) => sum + chunk.gzipped, 0);
  const optimizedTotal = optimized.reduce((sum, chunk) => sum + chunk.gzipped, 0);
  process.stdout.write(
    `${'total'.padEnd(width)}${kb(plainTotal).padEnd(16)}${kb(optimizedTotal).padEnd(12)}${change(plainTotal, optimizedTotal)}\n`,
  );
  totals.push(
    `${mode.padEnd(9)} gzip ${kb(plainTotal)} → ${kb(optimizedTotal)} (${change(plainTotal, optimizedTotal)})`,
  );
}
process.stdout.write(`\n## Totals\n\n${totals.join('\n')}\n`);
