/**
 * Builds the before-and-after examples on the landing page.
 *
 * Each example is compiled by Solid's JSX transform alone, and with
 * `compile` first. Both versions are also rendered on the server, so the
 * page can show the hydration keys. The results go into `src/showcase.json`.
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
