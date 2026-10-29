/**
 * Measures two codegen leftovers in built chunks: unused DOM walks
 * (`_el$2.firstChild;`) and wrapper functions called at once
 * (`(() => { ... })()`) around one element. Prints gzip with and without
 * the walks removed.
 * Usage: node ceiling.ts <dist dir with assets/>
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(path.join(process.cwd(), 'noop.js'));
const { minifySync } = require('vite') as typeof import('vite');

const assets = path.join(process.argv[2], 'assets');
let before = 0;
let after = 0;
let walks = 0;
let iifes = 0;
let walksInMin = 0;
const walk = /^[ \t]*[\w$]+(?:\.(?:firstChild|nextSibling|lastChild))+;[ \t]*\n/gm;
for (const name of readdirSync(assets)) {
  if (!name.endsWith('.js')) continue;
  const code = readFileSync(path.join(assets, name), 'utf8');
  const min = minifySync(name, code, { module: true }).code;
  walksInMin += (min.match(/[;{}][\w$]+(?:\.(?:firstChild|nextSibling))+;/g) ?? []).length;
  walks += (code.match(walk) ?? []).length;
  iifes += (code.match(/\(\(\) => \{\n\s*var _el\$/g) ?? []).length;
  before += gzipSync(min).byteLength;
  after += gzipSync(minifySync(name, code.replace(walk, ''), { module: true }).code).byteLength;
}
console.log(`${process.argv[2]}: walks ${walks} (kept by minifier: ${walksInMin}), element IIFEs ${iifes}, gzip ${before} -> ${after} without walks (${after - before} B)`);
