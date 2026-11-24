/**
 * Renders the docs in `src/content/docs` at build time. Adapted from the
 * seroval site's content plugin.
 *
 * - Importing a doc (`*.md`) gives `{ doc }`: its title, description, type,
 *   HTML and headings.
 * - `virtual:docs-manifest` lists every doc's slug, title, description and
 *   type, without the HTML, for the sidebar, the pager and the page head.
 * - The client build gets `search-index.json` for the search bar, and for
 *   agents `llms.txt`, `llms-full.txt` and a Markdown copy of every doc at its
 *   address with `.md`, like `/docs/guides/report.md`.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Marked } from 'marked';
import type { Tokens } from 'marked';
import type { Plugin, ViteDevServer } from 'vite';
import { SIDEBAR } from '../src/content/sidebar.ts';
import { highlight } from '../src/lib/highlight.ts';
import { buildSearchIndex } from './search-index.ts';
import type { Language } from '../src/lib/highlight.ts';

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

export interface DocMeta {
  /** The path under `/docs/`, without slashes at either end. The index is ''. */
  slug: string;
  title: string;
  description: string;
  type: string;
  /** The source file, relative to the repository root. */
  file: string;
}

export interface RenderedDoc extends DocMeta {
  html: string;
  headings: Heading[];
}

export const DOCS_DIR = path.join(import.meta.dirname, '..', 'src', 'content', 'docs');
const REPOSITORY_ROOT = path.join(import.meta.dirname, '..', '..');
const REPOSITORY = 'https://github.com/lxsmnsyc/solid-optimizer/blob/main/';
const MANIFEST_ID = 'virtual:docs-manifest';

const TYPES = new Set([
  'tutorial',
  'guide',
  'concept',
  'feature',
  'reference',
  'internals',
  'index',
]);

const LANGUAGES: Record<string, Language | undefined> = {
  ts: 'tsx',
  tsx: 'tsx',
  js: 'tsx',
  jsx: 'tsx',
  bash: 'bash',
  sh: 'bash',
  html: 'html',
};

const LANGUAGE_LABELS: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  jsx: 'JSX',
  bash: 'Terminal',
  sh: 'Terminal',
  html: 'HTML',
  json: 'JSON',
  text: 'Text',
};

/** Lucide icons, as SVG markup in the site's icon style. */
function icon(paths: string[], size = ''): string {
  const body = paths.map((d) => `<path d="${d}"/>`).join('');
  return `<svg class="icon${size}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

const ICONS = {
  copy: icon([
    'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2',
    'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  ]),
  check: icon(['M20 6 9 17l-5-5']),
  fail: icon(['M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20', 'm15 9-6 6', 'm9 9 6 6']),
  note: icon(['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18', 'M12 11v5', 'M12 8h.01'], ' icon-lg'),
  warning: icon(['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'], ' icon-lg'),
  tip: icon(
    [
      'M9 18h6',
      'M10 21h4',
      'M12 3a6 6 0 0 0-3.6 10.8c.5.4.8 1 .8 1.6V16h5.6v-.6c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z',
    ],
    ' icon-lg',
  ),
};

const CALLOUT_TONES: Record<string, string> = {
  NOTE: 'note',
  IMPORTANT: 'note',
  TIP: 'tip',
  WARNING: 'warning',
  CAUTION: 'danger',
};

function findCalloutIcon(tone: string): string {
  if (tone === 'warning' || tone === 'danger') {
    return ICONS.warning;
  }
  return tone === 'tip' ? ICONS.tip : ICONS.note;
}

export function escapeHTML(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll(/[^\w\s-]/g, '')
    .trim()
    .replaceAll(/\s+/g, '-');
}

function toText(html: string): string {
  return html
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .trim();
}

/** The slug of a doc file: its path under the docs folder, without `.md`. `index` is ''. */
export function slugOf(file: string): string {
  const relative = path.relative(DOCS_DIR, file).split(path.sep).join('/');
  const slug = relative.replace(/\.md$/, '');
  return slug === 'index' ? '' : slug.replace(/\/index$/, '');
}

export function hrefOf(slug: string): string {
  return slug === '' ? '/docs/' : `/docs/${slug}/`;
}

/** Every doc file under the docs folder. */
export async function listDocFiles(directory = DOCS_DIR): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listDocFiles(full)));
    } else if (entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files.sort();
}

/** Reads the `key: value` lines of a doc's frontmatter. */
function parseFrontmatter(
  source: string,
  file: string,
): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) {
    throw new Error(`${file} has no frontmatter`);
  }
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const pair = /^(\w+):\s*(.*)$/.exec(line);
    if (pair) {
      meta[pair[1]] = pair[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return { meta, body: source.slice(match[0].length) };
}

/**
 * Links between docs point at their pages. Other relative links point at
 * the file in the repository.
 */
function rewriteLink(href: string, file: string): string {
  if (/^[a-z]+:|^#|^\//i.test(href)) {
    return href;
  }
  const [target, hash] = href.split('#');
  const absolute = path.resolve(path.dirname(file), target);
  if (absolute.startsWith(DOCS_DIR) && absolute.endsWith('.md')) {
    return hrefOf(slugOf(absolute)) + (hash ? `#${hash}` : '');
  }
  const relative = path.relative(REPOSITORY_ROOT, absolute).split(path.sep).join('/');
  return REPOSITORY + relative + (hash ? `#${hash}` : '');
}

function codeBlock(code: string, lang: string, title: string | undefined): string {
  const language = LANGUAGES[lang];
  const html = language
    ? highlight(code, language)
    : `<pre class="twinkleplop"><code>${escapeHTML(code)}</code></pre>`;
  const name = title ? `<span class="code-block-name">${escapeHTML(title)}</span>` : '';
  const label = `<span class="code-lang">${escapeHTML(LANGUAGE_LABELS[lang] ?? lang)}</span>`;
  const copy = `<button class="code-copy" type="button" aria-label="Copy" data-copy><span class="swap"><span data-off>${ICONS.copy}</span><span data-on>${ICONS.check}</span><span data-fail>${ICONS.fail}</span></span></button>`;
  return `<div class="code-block${title ? ' has-name' : ''}">${name}${label}${copy}${html}</div>`;
}

/** Renders a doc into HTML, with highlighted code, heading anchors, input and output pairs, and callouts. */
export async function renderDoc(source: string, file: string): Promise<RenderedDoc> {
  const relativeFile = path.relative(REPOSITORY_ROOT, file).split(path.sep).join('/');
  const { meta, body } = parseFrontmatter(source, relativeFile);
  if (!meta.title || !meta.description || !meta.type || !TYPES.has(meta.type)) {
    throw new Error(`${relativeFile} needs a title, a description and a known type`);
  }
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  // An input fence opens a side by side pair; the output fence after it closes it.
  let compareOpen = false;

  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(token: Tokens.Heading) {
        // `## Text {#id}` sets the id; otherwise it comes from the text.
        const explicit = /\s*\{#([\w-]+)\}\s*$/.exec(token.text);
        const html = this.parser.parseInline(token.tokens).replace(/\s*\{#[\w-]+\}\s*$/, '');
        const base = explicit ? explicit[1] : slugify(token.text);
        const count = used.get(base) ?? 0;
        used.set(base, count + 1);
        const id = count ? `${base}-${String(count)}` : base;
        headings.push({ depth: token.depth, text: toText(html), id });
        return `<h${String(token.depth)} id="${id}">${html}<a class="heading-anchor" href="#${id}" aria-label="Link to this section">#</a></h${String(token.depth)}>\n`;
      },
      code(token: Tokens.Code) {
        const [lang = 'text', ...rest] = (token.lang ?? '').split(/\s+/);
        const options = rest.join(' ');
        const title = /title="([^"]*)"/.exec(options)?.[1];
        const side = /compare="(input|output)"/.exec(options)?.[1];
        if (side === 'input') {
          compareOpen = true;
          return `<div class="compare"><div class="compare-pane"><div class="compare-head"><span class="compare-label">Input</span></div>${codeBlock(token.text, lang, title)}</div>`;
        }
        if (side === 'output' && compareOpen) {
          compareOpen = false;
          return `<div class="compare-pane" data-side="after"><div class="compare-head"><span class="compare-label">Output</span></div>${codeBlock(token.text, lang, title)}</div></div>\n`;
        }
        return codeBlock(token.text, lang, title);
      },
      link(token: Tokens.Link) {
        const html = this.parser.parseInline(token.tokens);
        const href = rewriteLink(token.href, file);
        const external = /^https?:/.test(href);
        const attributes = external ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${escapeHTML(href)}"${attributes}>${html}</a>`;
      },
      table(token: Tokens.Table) {
        let head = '';
        for (const cell of token.header) {
          head += `<th scope="col">${this.parser.parseInline(cell.tokens)}</th>`;
        }
        let rows = '';
        for (const row of token.rows) {
          let cells = '';
          for (const cell of row) {
            cells += `<td>${this.parser.parseInline(cell.tokens)}</td>`;
          }
          rows += `<tr>${cells}</tr>`;
        }
        return `<div class="table-scroll"><table class="table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
      blockquote(token: Tokens.Blockquote) {
        const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(token.text);
        const inner = this.parser.parse(token.tokens);
        if (!alert) {
          return `<blockquote>${inner}</blockquote>`;
        }
        const tone = CALLOUT_TONES[alert[1]];
        const glyph = findCalloutIcon(tone);
        // The first paragraph holds the marker and, in bold, the title.
        const text = inner
          .replace(/^<p>\[!\w+\]\s*/, '<p>')
          .replace(/^<p>\s*<strong>([\s\S]*?)<\/strong>\s*/, '<p class="callout-title">$1</p><p>')
          .replaceAll('<p></p>', '');
        return `<aside class="callout" data-tone="${tone}">${glyph}<div>${text}</div></aside>\n`;
      },
    },
  });

  const html = await marked.parse(body);
  return {
    slug: slugOf(file),
    title: meta.title,
    description: meta.description,
    type: meta.type,
    file: relativeFile,
    html,
    headings,
  };
}

export async function loadDocs(): Promise<RenderedDoc[]> {
  const docs: RenderedDoc[] = [];
  for (const file of await listDocFiles()) {
    docs.push(await renderDoc(await readFile(file, 'utf8'), file));
  }
  return docs;
}

interface SourceDoc {
  doc: RenderedDoc;
  /** The Markdown of the doc without its frontmatter. */
  body: string;
  section: string;
}

/** Every doc in sidebar order, with its Markdown and its section. */
async function loadOrderedDocs(): Promise<SourceDoc[]> {
  const bySlug = new Map<string, { doc: RenderedDoc; body: string }>();
  for (const file of await listDocFiles()) {
    const source = await readFile(file, 'utf8');
    const doc = await renderDoc(source, file);
    bySlug.set(doc.slug, { doc, body: source.replace(/^---\n[\s\S]*?\n---\n/, '').trim() });
  }
  const ordered: SourceDoc[] = [];
  for (const section of SIDEBAR) {
    for (const slug of section.slugs) {
      const found = bySlug.get(slug);
      if (found) {
        ordered.push({ ...found, section: section.title });
      }
    }
  }
  return ordered;
}

/** Where the Markdown copy of a doc is served: `docs/guides/report.md`, or `docs/index.md`. */
function markdownPathOf(slug: string): string {
  return slug === '' ? 'docs/index.md' : `docs/${slug}.md`;
}

/** A doc as Markdown for agents: its title, its lead, and links that point at the other copies. */
function buildMarkdownCopy(source: SourceDoc, site: string): string {
  const file = path.join(REPOSITORY_ROOT, source.doc.file);
  const body = source.body.replaceAll(
    /\]\(([^)\s]+?\.md)(#[^)\s]*)?\)/g,
    (match, target: string, hash?: string) => {
      if (/^[a-z]+:/i.test(target)) {
        return match;
      }
      const absolute = path.resolve(path.dirname(file), target);
      if (!absolute.startsWith(DOCS_DIR)) {
        return match;
      }
      return `](${site}/${markdownPathOf(slugOf(absolute))}${hash ?? ''})`;
    },
  );
  return `# ${source.doc.title}\n\n> ${source.doc.description}\n\n${body}\n`;
}

/** `llms.txt`: what the site is, and a link to the Markdown of every doc, by section. */
function buildLLMsText(docs: readonly SourceDoc[], site: string): string {
  const lines = [
    '# solid-optimizer',
    '',
    '> A build-time optimizer for SolidJS 2.0. It rewrites JSX before Solid’s JSX transform: it inlines components, removes context providers, inlines memos, lowers Show and Switch, and folds control flow whose outcome is known at build time. It ships as `compile()` and a Vite plugin that replaces @solidjs/vite-plugin.',
    '',
    `The docs as one file: ${site}/llms-full.txt`,
  ];
  let section = '';
  for (const source of docs) {
    if (source.section !== section) {
      section = source.section;
      lines.push('', `## ${section}`, '');
    }
    lines.push(
      `- [${source.doc.title}](${site}/${markdownPathOf(source.doc.slug)}): ${source.doc.description}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** The files the client build gets besides the pages, by path. */
async function buildDocFiles(site: string): Promise<Map<string, string>> {
  const docs = await loadOrderedDocs();
  const files = new Map<string, string>();
  const index = buildSearchIndex(docs.map((source) => source.doc));
  files.set('search-index.json', JSON.stringify(index));
  files.set('llms.txt', buildLLMsText(docs, site));
  const copies: string[] = [];
  for (const source of docs) {
    const copy = buildMarkdownCopy(source, site);
    files.set(markdownPathOf(source.doc.slug), copy);
    copies.push(copy);
  }
  files.set('llms-full.txt', copies.join('\n---\n\n'));
  return files;
}

/** The Vite plugin. `site` is the site's origin, for the absolute links agents read. */
export function content(site: string): Plugin {
  let server: ViteDevServer | undefined;
  return {
    name: 'solid-optimizer-docs',
    enforce: 'pre',
    configureServer(devServer) {
      server = devServer;
      devServer.watcher.add(DOCS_DIR);
      // In dev, the search index and the files for agents are built on request.
      devServer.middlewares.use((request, response, next) => {
        const wanted = (request.url ?? '').split('?')[0].replace(/^\//, '');
        if (!/^(?:search-index\.json|llms(?:-full)?\.txt|docs\/.*\.md)$/.test(wanted)) {
          next();
          return;
        }
        buildDocFiles(site).then(
          (files) => {
            const file = files.get(wanted);
            if (file === undefined) {
              next();
              return;
            }
            response.setHeader(
              'Content-Type',
              wanted.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8',
            );
            response.end(file);
          },
          (error: unknown) => {
            next(error);
          },
        );
      });
    },
    async generateBundle() {
      // Only the client build is served; the server build only renders pages.
      if (this.environment.name !== 'client') {
        return;
      }
      for (const [fileName, source] of await buildDocFiles(site)) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
    handleHotUpdate(context) {
      // A change to any doc can change the manifest.
      if (context.file.startsWith(DOCS_DIR) && server) {
        const module = server.moduleGraph.getModuleById(`\0${MANIFEST_ID}`);
        if (module) {
          server.moduleGraph.invalidateModule(module);
        }
      }
    },
    resolveId(id) {
      return id === MANIFEST_ID ? `\0${MANIFEST_ID}` : null;
    },
    async load(id) {
      if (id === `\0${MANIFEST_ID}`) {
        const manifest: DocMeta[] = [];
        for (const doc of await loadDocs()) {
          manifest.push({
            slug: doc.slug,
            title: doc.title,
            description: doc.description,
            type: doc.type,
            file: doc.file,
          });
        }
        return `export default ${JSON.stringify(manifest)};`;
      }
      const file = id.split('?')[0];
      if (!file.endsWith('.md') || !file.startsWith(DOCS_DIR)) {
        return null;
      }
      const doc = await renderDoc(await readFile(file, 'utf8'), file);
      return `export const doc = ${JSON.stringify(doc)};`;
    },
  };
}
