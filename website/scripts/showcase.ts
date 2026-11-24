/**
 * Builds the before-and-after examples on the landing page.
 *
 * Each example is compiled by Solid's JSX transform alone, and with
 * `compile` first. Both versions are also rendered on the server, so the
 * page can show the hydration keys. The results go into `src/showcase.json`.
 *
 * The hero plays a few of them pass by pass: each step is the JSX the optimizer
 * writes with the passes so far switched on, with what Solid's JSX transform
 * makes of it. The last frame is Solid's output for the optimized JSX. Those
 * go into `src/hero.json`.
 *
 * Run it after a change to the optimizer: `pnpm --filter website showcase`.
 */
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { transform } from '@solidjs/compiler';
import { format } from 'oxfmt';
import { compile } from 'solid-optimizer';
import { EXAMPLES } from './examples.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(HERE, '..', 'src', 'showcase.json');
const HERO_OUTPUT = path.join(HERE, '..', 'src', 'hero.json');

/** The examples the hero plays, in order. */
const HERO_EXAMPLES = ['context', 'flags', 'components'];

/** The passes in the order the hero switches them on, each with its step label. */
const HERO_PASSES: [keyof typeof NO_PASSES, string][] = [
  ['inline', 'Inline components'],
  ['contexts', 'Remove providers'],
  ['memos', 'Inline memos'],
  ['conditionals', 'Lower Show and Switch'],
  ['fold', 'Fold constants'],
];

const NO_PASSES = {
  inline: false,
  contexts: false,
  memos: false,
  conditionals: false,
  fold: false,
};
const FILENAME = 'App.tsx';

function lower(code: string, generate: 'dom' | 'ssr'): string {
  return transform(code, {
    filename: FILENAME,
    moduleName: '@solidjs/web',
    generate,
    hydratable: true,
  }).code;
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function hasRender(value: unknown): value is { render: () => string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'render' in value &&
    typeof value.render === 'function'
  );
}

/** Renders a version of the example on the server and returns its HTML. */
async function serverRender(code: string, name: string): Promise<string> {
  const entry = `${code}\nimport { renderToString } from '@solidjs/web';\nexport const render = () => renderToString(() => <App />);\n`;
  // The module has to sit inside this package, so its imports resolve. The
  // JSX transform keeps the types, which Node strips from a `.mts` file.
  const file = path.join(HERE, `.render-${name}.mts`);
  writeFileSync(file, lower(entry, 'ssr'));
  try {
    const module: unknown = await import(pathToFileURL(file).href);
    if (!hasRender(module)) {
      throw new Error(`${name} has no render export`);
    }
    return module.render();
  } finally {
    rmSync(file);
  }
}

/** Formats code the way the rest of the repository is, for reading. */
async function tidy(code: string): Promise<string> {
  const result = await format(FILENAME, code, { singleQuote: true, printWidth: 80 });
  if (result.errors.length > 0) {
    throw new Error(`could not format:\n${code}`);
  }
  return result.code;
}

const VOID = new Set([
  'area',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'wbr',
]);
const TOKEN = /<!--[\s\S]*?-->|<\/?[a-z][^>]*>|[^<]+/gi;

interface Element {
  open: string;
  close: string;
  children: (Element | string)[];
}

/** Reads server HTML into a tree of elements, with text and comments as strings. */
function parseHTML(markup: string): Element {
  const root: Element = { open: '', close: '', children: [] };
  const stack = [root];
  for (const [token] of markup.matchAll(TOKEN)) {
    const parent = stack.at(-1) ?? root;
    if (token.startsWith('</')) {
      parent.close = token;
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }
    const tag = token.startsWith('<!--') ? undefined : /^<([a-z][\w-]*)/i.exec(token)?.[1];
    if (tag === undefined) {
      parent.children.push(token);
      continue;
    }
    const element: Element = { open: token, close: '', children: [] };
    parent.children.push(element);
    if (!VOID.has(tag.toLowerCase()) && !token.endsWith('/>')) {
      stack.push(element);
    }
  }
  return root;
}

function printInline(node: Element | string): string {
  if (typeof node === 'string') {
    return node;
  }
  let inner = '';
  for (const child of node.children) {
    inner += printInline(child);
  }
  return `${node.open}${inner}${node.close}`;
}

function printBlock(node: Element, depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth);
  // An element with no elements inside stays on one line.
  let nested = false;
  for (const child of node.children) {
    if (typeof child !== 'string') {
      nested = true;
    }
  }
  if (!nested) {
    lines.push(`${indent}${printInline(node)}`);
    return;
  }
  lines.push(`${indent}${node.open}`);
  // Text and comments between two elements share a line.
  let run = '';
  for (const child of node.children) {
    if (typeof child === 'string') {
      run += child;
      continue;
    }
    if (run.trim() !== '') {
      lines.push(`${indent}  ${run.trim()}`);
    }
    run = '';
    printBlock(child, depth + 1, lines);
  }
  if (run.trim() !== '') {
    lines.push(`${indent}  ${run.trim()}`);
  }
  lines.push(`${indent}${node.close}`);
}

/** Puts each element of server HTML that holds other elements on its own lines, indented. */
function formatHTML(markup: string): string {
  const lines: string[] = [];
  for (const child of parseHTML(markup).children) {
    if (typeof child === 'string') {
      lines.push(child);
    } else {
      printBlock(child, 0, lines);
    }
  }
  return lines.join('\n');
}

interface Side {
  /** The code Solid's JSX transform made for the client, formatted. */
  dom: string;
  /** The HTML the server sent. */
  html: string;
  templates: number;
  components: number;
  memos: number;
  hydrationKeys: number;
  markers: number;
  /** The size of the client code as the JSX transform wrote it, not formatted. */
  bytes: number;
  gzip: number;
}

async function measure(code: string, name: string): Promise<Side> {
  const dom = lower(code, 'dom');
  const html = await serverRender(code, name);
  return {
    dom: await tidy(dom),
    html: formatHTML(html),
    templates: count(dom, /_\$template\(/g),
    components: count(dom, /_\$createComponent\(/g),
    memos: count(dom, /\bcreateMemo\(/g),
    hydrationKeys: count(html, /_hk=/g),
    markers: count(html, /<!--[$/]-->/g),
    bytes: Buffer.byteLength(dom),
    gzip: gzipSync(dom, { level: 9 }).byteLength,
  };
}

const results = [];
for (const example of EXAMPLES) {
  const optimized = compile(example.code, { filename: FILENAME, sourceMap: false }).code;
  results.push({
    id: example.id,
    title: example.title,
    summary: example.summary,
    source: example.code,
    optimized: await tidy(optimized),
    plain: await measure(example.code, `${example.id}-plain`),
    after: await measure(optimized, `${example.id}-optimized`),
  });
}

writeFileSync(OUTPUT, `${JSON.stringify(results, null, 2)}\n`);
process.stdout.write(`Wrote ${OUTPUT}\n`);

/** Solid's `@solidjs/web` imports as one comment line, so the hero starts at what changes. */
function foldImports(code: string): string {
  const kept: string[] = [];
  let imports = 0;
  for (const line of code.trimEnd().split('\n')) {
    if (/^import .* from '@solidjs\/web';$/.test(line)) {
      imports += 1;
    } else {
      kept.push(line);
    }
  }
  return [`// ${String(imports)} imports from @solidjs/web`, ...kept].join('\n');
}

interface HeroStep {
  label: string;
  /** The JSX the optimizer writes with the passes so far, or the source for the first step. */
  jsx: string;
  /** What Solid's JSX transform makes of that JSX. */
  templates: number;
  components: number;
}

/** Formats JSX for the hero, narrower than the showcase so it fits beside the copy. */
async function tidyNarrow(code: string): Promise<string> {
  const result = await format(FILENAME, code, { singleQuote: true, printWidth: 72 });
  if (result.errors.length > 0) {
    throw new Error(`could not format:\n${code}`);
  }
  return result.code.trimEnd();
}

async function heroStep(label: string, jsx: string): Promise<HeroStep> {
  const dom = lower(jsx, 'dom');
  return {
    label,
    jsx: await tidyNarrow(jsx),
    templates: count(dom, /_\$template\(/g),
    components: count(dom, /_\$createComponent\(/g),
  };
}

const hero = [];
for (const id of HERO_EXAMPLES) {
  const example = EXAMPLES.find((item) => item.id === id);
  if (!example) {
    throw new Error(`no example ${id}`);
  }
  const steps = [await heroStep('Your code', example.code)];
  const on = { ...NO_PASSES };
  let last = example.code;
  for (const [pass, label] of HERO_PASSES) {
    on[pass] = true;
    const jsx = compile(example.code, { filename: FILENAME, sourceMap: false, ...on }).code;
    const step = await heroStep(label, jsx);
    // A pass that changes nothing in this example is not a step.
    if (step.jsx !== steps.at(-1)?.jsx) {
      steps.push(step);
      last = jsx;
    }
  }
  // The last frame: what Solid's JSX transform makes of the optimized JSX.
  const output = foldImports(await tidy(lower(last, 'dom')));
  hero.push({ id, title: example.title, steps, output });
}

writeFileSync(HERO_OUTPUT, `${JSON.stringify(hero, null, 2)}\n`);
process.stdout.write(`Wrote ${HERO_OUTPUT}\n`);
