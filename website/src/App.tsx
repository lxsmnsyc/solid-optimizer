import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';
import { Code, CopyButton } from './components/Code';
import { Repl } from './components/Repl';

const REPOSITORY = 'https://github.com/lxsmnsyc/solid-optimizer';
const NPM = 'https://www.npmjs.com/package/solid-optimizer';
const INSTALL = 'npm i -D solid-optimizer@next';

function Mark(): JSX.Element {
  return (
    <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="mark-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#76b3e1" />
          <stop offset="1" stop-color="#2c4f7c" />
        </linearGradient>
      </defs>
      <path d="M6 7h20l-5 5H6z" fill="#446b9e" />
      <path d="M6 14h20l-5 5H6z" fill="#4f88c6" />
      <path d="M6 21h20l-5 5H6z" fill="url(#mark-gradient)" />
    </svg>
  );
}

function GitHubIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" class="icon">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

function Header(): JSX.Element {
  return (
    <header class="nav">
      <a class="brand" href="#top">
        <Mark />
        <span>solid-optimizer</span>
      </a>
      <nav class="nav-links">
        <a href="#repl">REPL</a>
        <a href="#passes">Passes</a>
        <a href="#usage">Usage</a>
        <a
          class="nav-icon"
          href={REPOSITORY}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
        >
          <GitHubIcon />
        </a>
      </nav>
    </header>
  );
}

/** Five templates fold into one, the result of the Components preset. */
function TemplateStack(): JSX.Element {
  const rows = ['<span>', '<button>', '<p class=counter>', '<pre>debug panel', '<main><h1>Hello'];
  return (
    <div class="stack" aria-hidden="true">
      <div class="stack-column">
        <span class="stack-label">@solidjs/compiler</span>
        <For each={rows}>
          {(row, index) => (
            <div class="stack-row" style={{ '--i': index() }}>
              <span class="stack-var">_tmpl${index() + 1}</span>
              <code>{row}</code>
            </div>
          )}
        </For>
        <span class="stack-count">5 templates</span>
      </div>
      <div class="stack-arrow">
        <span />
      </div>
      <div class="stack-column optimized">
        <span class="stack-label">solid-optimizer → @solidjs/compiler</span>
        <div class="stack-row merged">
          <span class="stack-var">_tmpl$</span>
          <code>
            {
              '<main><h1>Hello</h1><p class=counter>Clicks: <!> <button type=button><span class="icon icon-plus"></span>Add'
            }
          </code>
        </div>
        <span class="stack-count">1 template</span>
      </div>
    </div>
  );
}

function Hero(): JSX.Element {
  return (
    <section class="hero" id="top">
      <div class="hero-grid" aria-hidden="true" />
      <div class="hero-glow" aria-hidden="true" />
      <a class="eyebrow" href={NPM} target="_blank" rel="noopener noreferrer">
        <span class="pulse" />
        1.0.0-next · SolidJS 2.0
      </a>
      <h1>
        Fewer templates.
        <br />
        <span class="gradient-text">Same app.</span>
      </h1>
      <p class="lede">
        A compile-time optimizer that inlines components, removes context providers, and folds
        control flow before Solid's JSX transform runs. More markup lands in fewer templates.
      </p>
      <div class="hero-actions">
        <a class="button primary" href="#repl">
          Open the REPL
        </a>
        <div class="install">
          <span class="prompt">$</span>
          <code>{INSTALL}</code>
          <CopyButton text={INSTALL} />
        </div>
      </div>
      <TemplateStack />
    </section>
  );
}

interface Pass {
  title: string;
  text: string;
  before: string;
  after: string;
}

const PASSES: Pass[] = [
  {
    title: 'Component inlining',
    text: 'A call becomes the component’s JSX, so it joins the parent’s template.',
    before: `function Title(props) {
  return <h1 class="title">{props.label}</h1>;
}

<main><Title label="Hello" /></main>`,
    after: `<main>
  <h1 class="title">{'Hello'}</h1>
</main>`,
  },
  {
    title: 'Context inlining',
    text: 'A provider whose readers are all visible is removed. Each read gets its value.',
    before: `<Theme value="dark">
  <Label />
</Theme>

// Label: useContext(Theme)`,
    after: `<span class={'dark'}>label</span>`,
  },
  {
    title: 'Memo inlining',
    text: 'A memo that always makes a new value and is read once becomes its computation.',
    before: `const style = createMemo(() => ({
  color: color(),
}));
<p style={style()} />`,
    after: `<p style={{ color: color() }} />`,
  },
  {
    title: 'Control flow folding',
    text: '<Show>, <Switch>, <For> and <Dynamic> resolve when their props are constants.',
    before: `const LINKS = [{ href: '/' }, { href: '/docs' }];
<For each={LINKS}>
  {(link) => <a href={link.href} />}
</For>`,
    after: `<a href={'/'} /><a href={'/docs'} />`,
  },
];

function Passes(): JSX.Element {
  return (
    <section class="section" id="passes">
      <h2 class="section-title">
        Four passes, <span class="gradient-text">repeated until nothing changes</span>
      </h2>
      <div class="passes">
        <For each={PASSES}>
          {(pass, index) => (
            <article class="pass">
              <header>
                <span class="pass-index">0{index() + 1}</span>
                <h3>{pass.title}</h3>
              </header>
              <p>{pass.text}</p>
              <div class="pass-code">
                <Code code={pass.before} />
                <span class="pass-arrow" aria-hidden="true">
                  ↓
                </span>
                <Code code={pass.after} class="after" />
              </div>
            </article>
          )}
        </For>
      </div>
    </section>
  );
}

const VITE_USAGE = `// vite.config.ts
import { defineConfig } from 'vite';
import solid from 'solid-optimizer/vite';

export default defineConfig({
  // Replaces @solidjs/vite-plugin, with the same options.
  plugins: [solid()],
});`;

const API_USAGE = `import { compile } from 'solid-optimizer';

const result = compile(code, { filename: 'app.tsx' });

result.code; // JSX, ready for Solid's JSX transform
result.map;  // a source map, or null when nothing changed`;

function Usage(): JSX.Element {
  return (
    <section class="section" id="usage">
      <h2 class="section-title">
        Drop-in for <span class="gradient-text">Vite</span>
      </h2>
      <div class="usage">
        <div class="window">
          <div class="window-bar">
            <span class="dots" />
            vite.config.ts
          </div>
          <Code code={VITE_USAGE} />
        </div>
        <div class="window">
          <div class="window-bar">
            <span class="dots" />
            compile.ts
          </div>
          <Code code={API_USAGE} />
        </div>
      </div>
    </section>
  );
}

function Footer(): JSX.Element {
  return (
    <footer class="footer">
      <a class="brand" href="#top">
        <Mark />
        <span>solid-optimizer</span>
      </a>
      <span>MIT © lxsmnsyc</span>
      <nav>
        <a href={REPOSITORY} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <a href={NPM} target="_blank" rel="noopener noreferrer">
          npm
        </a>
      </nav>
    </footer>
  );
}

export function App(): JSX.Element {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <section class="section repl-section" id="repl">
          <h2 class="section-title">
            Watch it <span class="gradient-text">compile</span>
          </h2>
          <Repl />
        </section>
        <Passes />
        <Usage />
      </main>
      <Footer />
    </>
  );
}
