/**
 * Fails when the landing page shows more than 600 words. A landing page is
 * looked at, not read, so its text has a budget. Code, the hero's compiled
 * output, the FAQ, the collapsed benchmark table and the chart tooltips, which
 * repeat the values next to them, do not count.
 *
 * Usage: `node scripts/word-budget.ts` after `pnpm build`. `pnpm build` runs it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET = 600;
const PAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
  'client',
  'index.html',
);

/** Removes each element that opens with `open` and closes with `tag`, with what it holds. */
function removeElements(html: string, open: RegExp, tag: string): string {
  let result = html;
  for (;;) {
    const match = open.exec(result);
    if (!match) {
      return result;
    }
    // Count nested elements of the same tag to find the matching close.
    const pattern = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
    pattern.lastIndex = match.index + match[0].length;
    let depth = 1;
    let end = result.length;
    for (let found = pattern.exec(result); found; found = pattern.exec(result)) {
      depth += found[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        end = found.index + found[0].length;
        break;
      }
    }
    result = result.slice(0, match.index) + result.slice(end);
  }
}

const html = readFileSync(PAGE, 'utf8');
const main = /<main\b[\s\S]*<\/main>/.exec(html)?.[0] ?? '';
let text = main;
text = removeElements(text, /<pre\b[^>]*>/, 'pre');
text = removeElements(text, /<figure class="hero-steps"[^>]*>/, 'figure');
text = removeElements(text, /<section[^>]*id="faq"[^>]*>/, 'section');
text = removeElements(text, /<details class="bench-table"[^>]*>/, 'details');
text = removeElements(text, /<span class="bench-tip"[^>]*>/, 'span');
text = text.replaceAll(/<[^>]+>/g, ' ').replaceAll(/&[a-z#0-9]+;/g, ' ');

let words = 0;
for (const word of text.split(/\s+/)) {
  if (/[\p{L}\p{N}]/u.test(word)) {
    words += 1;
  }
}

if (words > BUDGET) {
  process.stderr.write(
    `The landing page shows ${String(words)} words, over the budget of ${String(BUDGET)}.\n`,
  );
  process.exit(1);
}
process.stdout.write(`The landing page shows ${String(words)} of ${String(BUDGET)} words.\n`);
