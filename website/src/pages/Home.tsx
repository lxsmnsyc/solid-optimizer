import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';
import { Benchmarks } from '../components/Benchmarks';
import { Code, CopyButton } from '../components/Code';
import { Footer, Header, INSTALL, NPM } from '../components/Layout';
import { Showcase } from '../components/Showcase';

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
        <a class="button primary" href="/docs/">
          Get started
        </a>
        <a class="button secondary" href="/repl/">
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
      <p class="section-lede">
        One import changes. The plugin wraps @solidjs/vite-plugin, so SSR, server functions, and HMR
        keep working.
      </p>
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
      <div class="section-links">
        <a href="/docs/#vite-options">Vite plugin options</a>
        <a href="/docs/#compile-options">compile options</a>
        <a href="/docs/#report">Why a component stays</a>
      </div>
    </section>
  );
}

function Closing(): JSX.Element {
  return (
    <section class="section closing">
      <h2 class="section-title">
        Try it on <span class="gradient-text">your components</span>
      </h2>
      <p class="section-lede">
        The REPL runs solid-optimizer and Solid’s JSX transform in your browser, as WebAssembly.
        Paste a few modules and compare the output, the templates, and the size.
      </p>
      <div class="hero-actions">
        <a class="button primary" href="/repl/">
          Open the REPL
        </a>
        <a class="button secondary" href="/docs/">
          Read the docs
        </a>
      </div>
    </section>
  );
}

export function Home(): JSX.Element {
  return (
    <>
      <Header page="home" />
      <main>
        <Hero />
        <section class="section" id="build">
          <h2 class="section-title">
            What changes <span class="gradient-text">in the build</span>
          </h2>
          <p class="section-lede">
            Six small apps, compiled by Solid’s JSX transform alone and with solid-optimizer first.
            Pick one to compare the JSX, the client code, and the HTML the server sends.
          </p>
          <Showcase />
        </section>
        <Passes />
        <section class="section" id="benchmarks">
          <h2 class="section-title">
            Less work <span class="gradient-text">at runtime</span>
          </h2>
          <Benchmarks />
        </section>
        <Usage />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
