/**
 * Splits an example's built JavaScript by where each byte comes from.
 * Usage: node split.ts <dist dir with assets/> [--json]
 *
 * Rolldown marks every module with `//#region <path>` in unminified output.
 * Each region is minified on its own; its share of the chunk's gzip size is
 * its share of the chunk's minified size. Code outside regions (imports,
 * exports, hoisted templates) is "chunk".
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.cwd(), 'noop.js'));
const { minifySync } = require('vite') as typeof import('vite');

const dir = process.argv[2];
const assets = path.join(dir, 'assets');

function categorize(region: string): string {
  const m = /.*node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(region.replaceAll('\\', '/'));
  if (m) return m[1];
  if (region.startsWith('\0') || region.includes('virtual:')) return 'virtual';
  return 'app';
}

function minSize(file: string, code: string): number {
  try {
    return minifySync(file, code, { module: true, compress: false, mangle: true }).code.length;
  } catch {
    return code.length;
  }
}

const totals = new Map<string, { min: number; gz: number }>();
const appFiles = new Map<string, { min: number; gz: number }>();
let chunkMinSum = 0;
let regionMinSum = 0;
let looseSum = 0;

function add(map: Map<string, { min: number; gz: number }>, key: string, min: number, gz: number) {
  const entry = map.get(key) ?? { min: 0, gz: 0 };
  entry.min += min;
  entry.gz += gz;
  map.set(key, entry);
}

for (const name of readdirSync(assets)) {
  if (!name.endsWith('.js')) continue;
  const code = readFileSync(path.join(assets, name), 'utf8');
  const whole = minifySync(name, code, { module: true }).code;
  const loose = minifySync(name, code, { module: true, compress: false, mangle: true }).code.length;
  looseSum += loose;
  const chunkGz = gzipSync(whole).byteLength;
  chunkMinSum += whole.length;

  // Cut the chunk into regions and the code between them
  const parts: { key: string; code: string }[] = [];
  const re = /\/\/#region (.+)\n([\s\S]*?)\/\/#endregion\n?/g;
  let last = 0;
  let outside = '';
  for (const m of code.matchAll(re)) {
    outside += code.slice(last, m.index);
    parts.push({ key: m[1].trim(), code: m[2] });
    last = m.index + m[0].length;
  }
  outside += code.slice(last);
  parts.push({ key: '<chunk>', code: outside });

  // Measure each part and scale to the chunk's gzip size
  const sizes = parts.map((p) => minSize(name, p.code));
  const sum = sizes.reduce((a, b) => a + b, 0);
  regionMinSum += sum;
  for (const [i, p] of parts.entries()) {
    const gz = sum ? (sizes[i] / sum) * chunkGz : 0;
    const cat = p.key === '<chunk>' ? 'chunk' : categorize(p.key);
    add(totals, cat, sizes[i], gz);
    if (cat === 'app') add(appFiles, p.key, sizes[i], gz);
  }
}

const all = [...totals.values()].reduce((a, b) => a + b.gz, 0);
const rows = [...totals.entries()].sort((a, b) => b[1].gz - a[1].gz);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ totals: Object.fromEntries(totals), app: Object.fromEntries(appFiles) }));
} else {
  console.log(`${dir}\n  gzip total ${(all / 1000).toFixed(2)} kB (regions minified alone: ${regionMinSum} B vs whole chunks same settings ${looseSum} B, fully minified ${chunkMinSum} B)`);
  for (const [k, v] of rows) {
    console.log(`  ${k.padEnd(34)} ${(v.gz / 1000).toFixed(2).padStart(7)} kB gz  ${((v.gz / all) * 100).toFixed(1).padStart(5)}%  ${(v.min / 1000).toFixed(2).padStart(7)} kB min`);
  }
  const top = [...appFiles.entries()].sort((a, b) => b[1].gz - a[1].gz).slice(0, 8);
  console.log('  top app modules:');
  for (const [k, v] of top) console.log(`    ${k.padEnd(60)} ${(v.gz / 1000).toFixed(2)} kB gz`);
}
