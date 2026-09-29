/**
 * Renders a before-and-after comparison of `solid-optimizer` as an image.
 *
 * `App.jsx` is compiled by Solid's JSX transform alone and with `compile`
 * first. Both are rendered on the server too. The results go into
 * `comparison.html`, which headless Chrome saves as `comparison.png`.
 *
 * Set `CHROME` to the Chrome binary when it is not in the default macOS location.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from '@solidjs/compiler';
import { compile } from 'solid-optimizer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const source = readFileSync(path.join(HERE, 'App.jsx'), 'utf8');

function lower(code: string, generate: 'dom' | 'ssr'): string {
  return transform(code, {
    filename: 'App.jsx',
    moduleName: '@solidjs/web',
    generate,
    hydratable: true,
  }).code;
}

const optimizedSource = compile(source, { filename: 'App.jsx', sourceMap: false }).code;

const regularOutput = lower(source, 'dom');
const optimizedOutput = lower(optimizedSource, 'dom');

function hasRender(value: unknown): value is { render: () => string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'render' in value &&
    typeof value.render === 'function'
  );
}

/**
 * Server-renders a version of the app and returns the HTML response body.
 */
async function serverRender(code: string, name: string): Promise<string> {
  const entry = `${code}\nimport { renderToString } from '@solidjs/web';\nexport const render = () => renderToString(() => <App />);\n`;
  // The module has to sit inside this package, so its imports resolve.
  const file = path.join(HERE, `.render-${name}.mjs`);
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

const regularHTML = await serverRender(source, 'regular');
const optimizedHTML = await serverRender(optimizedSource, 'optimized');

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function escapeHTML(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const TOKEN =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(import|from|export|function|return|const|var|let|get|if|true|false|null)\b|(<\/?[A-Za-z][\w.]*|\/?>)/g;

/**
 * Colors comments, strings, keywords, and JSX tags.
 */
function highlight(code: string): string {
  let out = '';
  let last = 0;
  for (const match of code.matchAll(TOKEN)) {
    out += escapeHTML(code.slice(last, match.index));
    const [text] = match;
    let kind = 'tag';
    if (match.at(1) !== undefined) {
      kind = 'comment';
    } else if (match.at(2) !== undefined) {
      kind = 'string';
    } else if (match.at(3) !== undefined) {
      kind = 'keyword';
    }
    out += `<span class="${kind}">${escapeHTML(text)}</span>`;
    last = match.index + text.length;
  }
  return out + escapeHTML(code.slice(last));
}

/**
 * Breaks server HTML before each tag, and marks what hydration reads.
 */
function highlightHTML(markup: string): string {
  return escapeHTML(markup.replaceAll(/(?=<[^!/])/g, '\n').trim())
    .replaceAll(/(_hk=\S+?)(?=[ &])/g, '<span class="key">$1</span>')
    .replaceAll(/(&lt;!--[^&]*--&gt;)/g, '<span class="marker">$1</span>');
}

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function plural(amount: number, noun: string): string {
  return `${String(amount)} ${noun}${amount === 1 ? '' : 's'}`;
}

function codeStats(code: string): string[] {
  return [
    plural(count(code, /_\$template\(/g), 'template'),
    plural(count(code, /_\$createComponent\(/g), 'component call'),
    plural(count(code, /_\$insert\(/g), 'insert'),
    plural(code.length, 'byte'),
  ];
}

function htmlStats(markup: string): string[] {
  return [
    plural(count(markup, /_hk=/g), 'hydration key'),
    plural(count(markup, /<!--[^>]*-->/g), 'marker'),
    plural(markup.length, 'byte'),
  ];
}

function panel(title: string, body: string, stats: string[], accent = false): string {
  const badges = stats.map((stat) => `<span class="stat">${stat}</span>`).join('');
  return `<section class="panel${accent ? ' accent' : ''}">
  <header><h2>${title}</h2><div class="stats">${badges}</div></header>
  <pre>${body}</pre>
</section>`;
}

const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 48px;
    width: 2400px;
    background: #0f1115;
    color: #d7dae0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  h1 { margin: 0 0 8px; font-size: 40px; color: #fff; }
  .subtitle { margin: 0 0 40px; font-size: 20px; color: #8b93a1; }
  h2.section { margin: 48px 0 16px; font-size: 26px; color: #fff; }
  h2.section:first-of-type { margin-top: 0; }
  .grid { display: grid; gap: 20px; align-items: start; }
  .three { grid-template-columns: 1fr 1fr 1fr; }
  .two { grid-template-columns: 1fr 1fr; }
  .panel { background: #171a21; border: 1px solid #262b35; border-radius: 12px; overflow: hidden; }
  .panel.accent { border-color: #4c8dff; box-shadow: 0 0 0 1px #4c8dff33; }
  .panel header { padding: 16px 20px; border-bottom: 1px solid #262b35; }
  .panel h2 { margin: 0; font-size: 18px; color: #fff; }
  .panel.accent h2 { color: #7fb0ff; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .stat { font-size: 13px; padding: 3px 10px; border-radius: 999px; background: #232833; color: #aeb6c4; }
  .accent .stat { background: #1c2d4d; color: #a9c8ff; }
  pre {
    margin: 0;
    padding: 18px 20px;
    font: 13px/1.55 'SF Mono', Menlo, monospace;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .comment { color: #6b7385; }
  .string { color: #a6d98a; }
  .keyword { color: #d49bff; }
  .tag { color: #7fc8ff; }
  .key { color: #ffb86b; }
  .marker { color: #ff7b8a; }
</style>
</head>
<body>
  <h1>solid-optimizer</h1>
  <p class="subtitle">One component tree, compiled with Solid's JSX transform alone and with solid-optimizer first.</p>

  <h2 class="section">Build output, after the JSX transform</h2>
  <div class="grid three">
    ${panel('Source', highlight(source), [plural(count(source, /^(export )?function /gm), 'component'), plural(source.length, 'byte')])}
    ${panel('Regular output', highlight(regularOutput), codeStats(regularOutput))}
    ${panel('Optimized output', highlight(optimizedOutput), codeStats(optimizedOutput), true)}
  </div>

  <h2 class="section">Server HTML response</h2>
  <div class="grid two">
    ${panel('Regular', highlightHTML(regularHTML), htmlStats(regularHTML))}
    ${panel('Optimized', highlightHTML(optimizedHTML), htmlStats(optimizedHTML), true)}
  </div>
</body>
</html>
`;

const htmlFile = path.join(HERE, 'comparison.html');
writeFileSync(htmlFile, page);

// ---------------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------------

interface DevToolsMessage {
  id?: number;
  result?: Record<string, unknown>;
}

function isMessage(value: unknown): value is DevToolsMessage {
  return typeof value === 'object' && value !== null;
}

/**
 * Starts headless Chrome and returns the WebSocket URL of a new page.
 */
async function startChrome(profile: string): Promise<{ url: string; stop: () => Promise<void> }> {
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--hide-scrollbars',
    'about:blank',
  ]);
  const browserURL = await new Promise<string>((resolve, reject) => {
    let output = '';
    chrome.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
      if (match?.[1]) {
        resolve(match[1]);
      }
    });
    chrome.on('exit', () => {
      reject(new Error(`Chrome exited before it was ready:\n${output}`));
    });
  });
  const { host } = new URL(browserURL);
  const targets: unknown = await (await fetch(`http://${host}/json/list`)).json();
  if (!Array.isArray(targets)) {
    throw new Error('Chrome listed no pages');
  }
  const target: unknown = targets.find(
    (item: unknown) => isMessage(item) && 'type' in item && item.type === 'page',
  );
  if (
    !isMessage(target) ||
    !('webSocketDebuggerUrl' in target) ||
    typeof target.webSocketDebuggerUrl !== 'string'
  ) {
    throw new Error('Chrome has no page to drive');
  }
  return {
    url: target.webSocketDebuggerUrl,
    stop: async () => {
      const exited = new Promise<void>((resolve) => {
        chrome.once('exit', () => {
          resolve();
        });
      });
      chrome.kill();
      await exited;
    },
  };
}

async function screenshot(file: string, output: string): Promise<void> {
  const profile = mkdtempSync(path.join(tmpdir(), 'showcase-chrome-'));
  const chrome = await startChrome(profile);
  const socket = new WebSocket(chrome.url);
  const pending = new Map<number, (result: Record<string, unknown>) => void>();
  let nextId = 0;
  socket.addEventListener('message', (event) => {
    const message: unknown = JSON.parse(String(event.data));
    if (isMessage(message) && message.id !== undefined) {
      pending.get(message.id)?.(message.result ?? {});
      pending.delete(message.id);
    }
  });
  const send = async (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    nextId += 1;
    const id = nextId;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  await new Promise((resolve) => {
    socket.addEventListener('open', resolve, { once: true });
  });
  try {
    await send('Page.enable');
    await send('Page.navigate', { url: pathToFileURL(file).href });
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    const size = await send('Runtime.evaluate', {
      expression: 'JSON.stringify([document.body.scrollWidth, document.body.scrollHeight])',
      returnByValue: true,
    });
    const value: unknown = isMessage(size.result) ? Reflect.get(size.result, 'value') : undefined;
    const dimensions: unknown = JSON.parse(String(value));
    const list: unknown[] = Array.isArray(dimensions) ? dimensions : [];
    const width = list.at(0);
    const height = list.at(1);
    if (typeof width !== 'number' || typeof height !== 'number') {
      throw new Error('could not measure the page');
    }
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(output, Buffer.from(String(shot.data), 'base64'));
  } finally {
    socket.close();
    await chrome.stop();
    // Chrome's helper processes can still be writing to the profile for a moment after it exits.
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

await screenshot(htmlFile, path.join(HERE, 'comparison.png'));
process.stdout.write(`Wrote ${path.join(HERE, 'comparison.png')}\n`);
