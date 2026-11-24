import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';
import { Benchmarks } from '../components/Benchmarks';
import { Code } from '../components/Code';
import { HeroSteps } from '../components/HeroSteps';
import { Icon } from '../components/Icon';
import { InstallCommand } from '../components/InstallCommand';
import { Footer, Header } from '../components/Layout';
import { Showcase } from '../components/Showcase';

/** Banig's SectionHead: the row title and its lead, on the page above the row's tiles. */
function SectionHead(props: { title: string; lead: string }): JSX.Element {
  return (
    <header class="section-head">
      <h2 class="row-title">{props.title}</h2>
      <p class="row-lead">{props.lead}</p>
    </header>
  );
}

function Hero(): JSX.Element {
  return (
    <section class="hero" id="top">
      <div class="hero-copy">
        <h1 class="hero-title">
          Same Solid app. <em>2× faster</em> server rendering.
          <a class="footnote-ref" href="#bench-note" aria-label="How this was measured">
            1
          </a>
        </h1>
        <p class="hero-tagline">
          A build-time optimizer for SolidJS 2.0. It inlines your components, so the server and the
          browser run less code.
        </p>
        <div class="hero-actions">
          <a class="button" data-variant="primary" href="/docs/">
            Get started
            <Icon name="arrow-right" class="icon-arrow" />
          </a>
          <a class="button" data-variant="quiet" href="/repl/">
            Open the REPL
          </a>
        </div>
        <InstallCommand />
      </div>
      <HeroSteps />
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
    <section class="landing-row" id="passes">
      <SectionHead
        title="Four passes, run until nothing changes"
        lead="Each pass can expose work for the next."
      />
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
                <span class="pass-arrow">
                  <Icon name="arrow-down" />
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

interface Row {
  label: string;
  solid: string;
  hand: string;
  optimizer: string;
}

const COMPARISON: Row[] = [
  {
    label: 'Components join their parent’s template',
    solid: 'No',
    hand: 'Yes',
    optimizer: 'Yes',
  },
  { label: 'Your source keeps its components', solid: 'Yes', hand: 'No', optimizer: 'Yes' },
  {
    label: 'Providers go when every reader is known',
    solid: 'No',
    hand: 'By hand',
    optimizer: 'Yes',
  },
  { label: 'Constant branches fold', solid: 'With optimize', hand: 'By hand', optimizer: 'Yes' },
  { label: 'Lists what it left alone', solid: 'No', hand: 'No', optimizer: 'Yes' },
];

function Comparison(): JSX.Element {
  return (
    <section class="landing-row" id="compare">
      <SectionHead
        title="Why not inline by hand?"
        lead="You would trade readable components for speed. solid-optimizer keeps both."
      />
      <div class="tile table-scroll">
        <table class="table compare-table">
          <thead>
            <tr>
              <th scope="col">
                <span class="visually-hidden">Feature</span>
              </th>
              <th scope="col">Solid alone</th>
              <th scope="col">By hand</th>
              <th scope="col">solid-optimizer</th>
            </tr>
          </thead>
          <tbody>
            <For each={COMPARISON}>
              {(row) => (
                <tr>
                  <th scope="row">{row.label}</th>
                  <td>{row.solid}</td>
                  <td>{row.hand}</td>
                  <td data-best>{row.optimizer}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface Question {
  question: string;
  answer: JSX.Element;
}

const QUESTIONS: Question[] = [
  {
    question: 'Is it ready to use?',
    answer: <>Version 1.0 is out for SolidJS 2.0, under the MIT license.</>,
  },
  {
    question: 'Does it work with Solid 1?',
    answer: (
      <>
        Use <code>solid-optimizer@0</code>. It gets fixes only.
      </>
    ),
  },
  {
    question: 'Can it break hydration?',
    answer: (
      <>
        The Vite plugin compiles the server and client builds the same way, so both render the same
        tree. See <a href="/docs/#hydration">Hydration</a>.
      </>
    ),
  },
  {
    question: 'Will my bundle grow?',
    answer: (
      <>
        A component only inlines where its copies are no larger than its calls. See{' '}
        <a href="/docs/#only-where-smaller">Only where it is smaller</a>.
      </>
    ),
  },
  {
    question: 'Why did a component stay a component?',
    answer: (
      <>
        Turn on <code>optimizer.report</code>. It lists what stayed as written and why. See{' '}
        <a href="/docs/#report">Report</a>.
      </>
    ),
  },
];

function Faq(): JSX.Element {
  return (
    <section class="landing-row" id="faq">
      <SectionHead title="Questions" lead="What people ask before they add it." />
      <div class="tile faq">
        <For each={QUESTIONS}>
          {(item) => (
            <details class="faq-item">
              <summary>
                {item.question}
                <Icon name="chevron-down" />
              </summary>
              <p>{item.answer}</p>
            </details>
          )}
        </For>
      </div>
    </section>
  );
}

export function Home(): JSX.Element {
  return (
    <>
      <Header page="home" />
      <main id="main" class="landing">
        <Hero />
        <section class="landing-row" id="benchmarks">
          <SectionHead
            title="Half the server render time"
            lead="Two real apps, rendered with and without solid-optimizer. Lower is better."
          />
          <div class="tile">
            <Benchmarks />
          </div>
        </section>
        <section class="landing-row" id="build">
          <SectionHead
            title="Less code in every build"
            lead="Six small apps. Pick one to compare Solid’s output with and without it."
          />
          <Showcase />
        </section>
        <section class="landing-row" id="usage">
          <SectionHead
            title="One import changes"
            lead="It wraps @solidjs/vite-plugin, so SSR, server functions and HMR keep working."
          />
          <div class="tile usage-tile">
            <div class="code-block">
              <Code code={VITE_USAGE} />
            </div>
            <a class="usage-link" href="/docs/#setup">
              Set up the Vite plugin
              <Icon name="arrow-right" class="icon-arrow" />
            </a>
          </div>
        </section>
        <Passes />
        <Comparison />
        <Faq />
        <section class="tile closing" data-tone="ink">
          <h2 class="row-title">Try it on your components</h2>
          <p class="hero-tagline">The REPL runs both compilers in your browser.</p>
          <div class="hero-actions">
            <a class="button" data-variant="primary" href="/repl/">
              Open the REPL
              <Icon name="arrow-right" class="icon-arrow" />
            </a>
            <a class="button" data-variant="quiet" href="/docs/">
              Read the docs
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
