import type { JSX } from '@solidjs/web';
import { For, Show, createSignal, onSettled } from 'solid-js';
import { Code } from '../components/Code';
import { Footer, Header, REPOSITORY } from '../components/Layout';
import type { Language } from '../lib/highlight';

const STRATEGY = `${REPOSITORY}/blob/main/strategy.md`;

interface Entry {
  id: string;
  label: string;
}

interface Group {
  title: string;
  entries: Entry[];
}

const NAVIGATION: Group[] = [
  {
    title: 'Getting started',
    entries: [
      { id: 'introduction', label: 'Introduction' },
      { id: 'install', label: 'Install' },
      { id: 'setup', label: 'Set up Vite' },
      { id: 'hydration', label: 'Hydration' },
    ],
  },
  {
    title: 'Vite plugin',
    entries: [
      { id: 'modes', label: 'Chunk and module mode' },
      { id: 'cross-module', label: 'Constants across modules' },
      { id: 'vite-options', label: 'Options' },
      { id: 'report', label: 'Report' },
      { id: 'limits', label: 'Limits' },
    ],
  },
  {
    title: 'API',
    entries: [
      { id: 'compile', label: 'compile' },
      { id: 'compile-options', label: 'compile options' },
      { id: 'read-module-constants', label: 'readModuleConstants' },
    ],
  },
  {
    title: 'Passes',
    entries: [
      { id: 'inline', label: 'Component inlining' },
      { id: 'contexts', label: 'Context inlining' },
      { id: 'memos', label: 'Memo inlining' },
      { id: 'fold', label: 'Folding and control flow' },
    ],
  },
];

function Section(props: { id: string; title: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="doc-section" id={props.id}>
      <h2>
        <a href={`#${props.id}`}>{props.title}</a>
      </h2>
      {props.children}
    </section>
  );
}

function Block(props: { code: string; lang?: Language; title?: string }): JSX.Element {
  return (
    <div class="doc-code">
      <Show when={props.title}>
        <div class="doc-code-title">{props.title}</div>
      </Show>
      <Code code={props.code} lang={props.lang} />
    </div>
  );
}

function Compare(props: { before: string; after: string }): JSX.Element {
  return (
    <div class="doc-compare">
      <Block code={props.before} title="Input" />
      <Block code={props.after} title="Output" />
    </div>
  );
}

interface Option {
  name: string;
  type: string;
  default?: string;
  text: JSX.Element;
}

function Options(props: { options: Option[] }): JSX.Element {
  return (
    <div class="doc-options">
      <For each={props.options}>
        {(option) => (
          <div class="doc-option" id={`option-${option.name.replaceAll('.', '-')}`}>
            <div class="doc-option-head">
              <code class="doc-option-name">{option.name}</code>
              <code class="doc-option-type">{option.type}</code>
              <Show when={option.default}>
                <span class="doc-option-default">
                  default <code>{option.default}</code>
                </span>
              </Show>
            </div>
            <p>{option.text}</p>
          </div>
        )}
      </For>
    </div>
  );
}

interface Reason {
  codes: string[];
  text: JSX.Element;
}

function Reasons(props: { reasons: Reason[] }): JSX.Element {
  return (
    <table class="doc-table">
      <thead>
        <tr>
          <th scope="col">Reason</th>
          <th scope="col">Meaning</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.reasons}>
          {(reason) => (
            <tr>
              <td>
                <For each={reason.codes}>{(code) => <code>{code}</code>}</For>
              </td>
              <td>{reason.text}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

function Note(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <aside class="doc-note">
      <strong>{props.title}</strong>
      <p>{props.children}</p>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Getting started
// ---------------------------------------------------------------------------

const PIPELINE = `your JSX ──▶ solid-optimizer ──▶ JSX ──▶ @solidjs/compiler ──▶ JavaScript`;

const VITE_SETUP = `// vite.config.ts
import { defineConfig } from 'vite';
import solid from 'solid-optimizer/vite';

export default defineConfig({
  // Replaces @solidjs/vite-plugin, with the same options.
  plugins: [solid({ ssr: true })],
});`;

const VITE_CONFIGURED = `import { defineConfig } from 'vite';
import solid from 'solid-optimizer/vite';

export default defineConfig({
  plugins: [
    solid({
      ssr: true,
      optimizer: {
        // Leave context providers in place.
        contexts: false,
        // Print what stays as written in each build, and why.
        report: true,
      },
    }),
  ],
});`;

function GettingStarted(): JSX.Element {
  return (
    <>
      <Section id="introduction" title="Introduction">
        <p>
          solid-optimizer rewrites JSX before Solid’s JSX transform lowers it. It inlines
          components, removes context providers, inlines memos, and resolves control flow whose
          outcome is known at build time. More markup lands in fewer templates, so the browser
          clones fewer of them, the server sends fewer hydration keys, and fewer component calls
          run.
        </p>
        <Block code={PIPELINE} lang="bash" />
        <p>
          The input and the output are both JSX. The optimizer never lowers JSX itself, so whatever
          Solid’s JSX transform does with templates, events, and hydration stays the same.
        </p>
        <p>
          It is built for SolidJS 2.0 and <code>@solidjs/compiler</code>. Try it on your own
          components in the <a href="/repl/">REPL</a>.
        </p>
      </Section>

      <Section id="install" title="Install">
        <p>
          The Solid 2.0 version is published under the <code>next</code> tag. The{' '}
          <code>latest</code> version is for Solid 1.x.
        </p>
        <Block code="npm i -D solid-optimizer@next" lang="bash" />
        <Block code="pnpm add -D solid-optimizer@next" lang="bash" />
        <Block code="yarn add -D solid-optimizer@next" lang="bash" />
        <p>
          <code>@solidjs/vite-plugin</code> and <code>vite</code> are peer dependencies of the Vite
          plugin.
        </p>
      </Section>

      <Section id="setup" title="Set up Vite">
        <p>
          <code>solid-optimizer/vite</code> replaces <code>@solidjs/vite-plugin</code>. It takes the
          same options and wraps the official plugin, so SSR, server functions, and HMR keep
          working. Change the import and keep the options.
        </p>
        <Block code={VITE_SETUP} />
        <p>
          The optimizer runs on builds. It is off while serving, unless{' '}
          <a href="#option-optimizer-dev">
            <code>optimizer.dev</code>
          </a>{' '}
          is set. Pass <code>optimizer</code> to turn passes off or to print a report:
        </p>
        <Block code={VITE_CONFIGURED} />
      </Section>

      <Section id="hydration" title="Hydration">
        <Note title="Compile both builds the same way">
          The output changes the shape of the rendered tree, and with it the hydration keys.
          Inlining a component, removing a provider, or unrolling a list removes an owner. Compile a
          server build and its client build from the same code with the same options.
        </Note>
        <p>
          The Vite plugin does this for you: a hydrating build runs in module mode, where every
          decision depends only on the modules, never on how the bundler splits chunks. See{' '}
          <a href="#modes">Chunk and module mode</a>.
        </p>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Vite plugin
// ---------------------------------------------------------------------------

const REPORT_OUTPUT = `solid-optimizer: what stays as written in client
  inline   lazy              4  About, Chart, Dashboard, Settings
  inline   copy-no-host      1  Home (./pages/Home)
  inline   no-host           1  Home`;

const REPORT_FUNCTION = `solid({
  optimizer: {
    report(report) {
      // report.environment is the Vite environment, like 'client' or 'ssr'.
      for (const skip of report.skips) {
        console.log(skip.pass, skip.reason, skip.name);
      }
    },
  },
});`;

const VITE_OPTIONS: Option[] = [
  {
    name: 'optimizer',
    type: 'OptimizerOptions | false',
    text: (
      <>
        <code>false</code> uses <code>@solidjs/vite-plugin</code> as it is. Every other option of
        the plugin is passed to <code>@solidjs/vite-plugin</code>.
      </>
    ),
  },
  {
    name: 'optimizer.mode',
    type: "'auto' | 'module'",
    default: "'auto'",
    text: (
      <>
        <code>'auto'</code> uses chunk mode for client builds that do not hydrate, and module mode
        for everything else. <code>'module'</code> never keeps JSX through bundling.
      </>
    ),
  },
  {
    name: 'optimizer.dev',
    type: 'boolean',
    default: 'false',
    text: <>Also optimizes while serving, in module mode.</>,
  },
  {
    name: 'optimizer.report',
    type: 'boolean | (report: OptimizerReport) => void',
    default: 'false',
    text: (
      <>
        Reports what stays as written in each build, and why. <code>true</code> prints it. A
        function receives it instead, once per build environment. See <a href="#report">Report</a>.
      </>
    ),
  },
  {
    name: 'optimizer.packages',
    type: 'string[]',
    default: '[]',
    text: (
      <>
        Packages whose components are copied into the modules that use them, like{' '}
        <code>['@kobalte/core']</code>. A package has to publish its JSX, as most Solid libraries do
        through the <code>solid</code> export condition. Their copies inline wherever they can be,
        so the bundler drops the originals, even when the package lands in another chunk. A listed
        package has to be bundled in every build, or the server and client builds copy different
        components.
      </>
    ),
  },
  {
    name: 'optimizer.inline',
    type: 'boolean',
    default: 'true',
    text: (
      <>
        Component inlining. Works like the <a href="#option-inline">compile option</a>.
      </>
    ),
  },
  {
    name: 'optimizer.alwaysInline',
    type: 'boolean',
    default: 'false',
    text: (
      <>
        Inlines every component that can be, even where the copies are larger than the calls. Works
        like the <a href="#option-alwaysInline">compile option</a>.
      </>
    ),
  },
  {
    name: 'optimizer.contexts',
    type: 'boolean',
    default: 'true',
    text: <>Context provider removal.</>,
  },
  {
    name: 'optimizer.memos',
    type: 'boolean',
    default: 'true',
    text: <>Memo inlining.</>,
  },
  {
    name: 'optimizer.fold',
    type: 'boolean',
    default: 'true',
    text: <>Constant folding and control-flow resolution.</>,
  },
  {
    name: 'optimizer.maxPasses',
    type: 'number',
    default: '10',
    text: <>The most rounds to run. Compilation stops early once a round changes nothing.</>,
  },
];

const INLINE_REASONS: Reason[] = [
  {
    codes: ['props-use', 'view-use'],
    text: (
      <>
        The component uses its props in a way other than <code>props.name</code>, a spread onto an
        element, or a <code>merge()</code> or <code>omit()</code> view, such as passing them to a
        function.
      </>
    ),
  },
  {
    codes: ['view-conflict'],
    text: <>A spread of the props would repeat an attribute the element already has.</>,
  },
  {
    codes: [
      'component-params',
      'component-body',
      'component-return',
      'component-async',
      'component-recursive',
      'component-this',
    ],
    text: <>The component’s own shape is not supported.</>,
  },
  {
    codes: ['component-write'],
    text: (
      <>
        The component’s statements assign to something declared outside it, like a counter at the
        top of the module. A copy’s statements run before the JSX around the call, so that JSX would
        see the write too early.
      </>
    ),
  },
  {
    codes: ['call-spread', 'call-namespace'],
    text: <>The call site passes a spread or a namespaced attribute.</>,
  },
  {
    codes: ['call-ref', 'ref-use'],
    text: (
      <>
        The call’s <code>ref</code> is an expression other than a name, a function, or an array of
        them, or the component uses <code>props.ref</code> other than as a <code>ref</code>.
      </>
    ),
  },
  {
    codes: ['no-host'],
    text: (
      <>
        The component has statements, and the call is not in JSX that a component or one of Solid’s
        callbacks returns. A <code>&lt;Show&gt;</code> child or a <code>fallback</code> is one such
        place.
      </>
    ),
  },
  {
    codes: ['size'],
    text: (
      <>
        The copies would be larger than the calls. See{' '}
        <a href="#only-where-smaller">Only where it is smaller</a>.
      </>
    ),
  },
  {
    codes: ['lazy', 'imported', 'nested', 'not-a-function'],
    text: <>The tag is not a component declared at the top of the same module or chunk.</>,
  },
  {
    codes: ['copy-package', 'copy-cycle', 'copy-virtual', 'copy-wrapper', 'copy-size'],
    text: (
      <>
        Copying a component from another module. It comes from a package that{' '}
        <code>optimizer.packages</code> does not list, its module imports the importer back, the
        copy would import a virtual module its specifier does not reach from the importer, the
        component only returns a call of another component in its module, or the copy was larger.
      </>
    ),
  },
];

const OTHER_REASONS: Reason[] = [
  {
    codes: ['open-component', 'open-call', 'open-new', 'open-spread', 'open-outer'],
    text: <>Provider pass: code under the provider that it cannot see into.</>,
  },
  {
    codes: ['provider-value', 'provider-undefined', 'provider-shape'],
    text: <>Provider pass: a value or a provider it cannot handle.</>,
  },
  {
    codes: ['memo-reads', 'memo-read-place', 'memo-constant'],
    text: <>Memo pass: a memo it keeps, because of how often or where it is read.</>,
  },
];

function VitePlugin(): JSX.Element {
  return (
    <>
      <Section id="modes" title="Chunk and module mode">
        <p>The plugin optimizes in one of two modes.</p>
        <div class="doc-cards">
          <div class="doc-card">
            <h3>Chunk mode</h3>
            <p>
              For client builds that do not hydrate. Constants fold and memos inline in each module
              first, so a branch that folds away takes its imports and <code>lazy()</code> chunks
              out of the bundle. Components imported from other modules are inlined there too, so
              the bundler drops them and the runtime code only they used. JSX is then kept through
              bundling. Each chunk is optimized as a whole and then lowered by Solid’s JSX
              transform, so a component inlines anywhere in its chunk. Each chunk is also built with
              every component inlined that can be, and the smaller one is kept.
            </p>
          </div>
          <div class="doc-card">
            <h3>Module mode</h3>
            <p>
              For everything else. Each module is optimized before the official plugin lowers it,
              with the components it imports from other modules copied in first. A server build and
              its client build split chunks differently, and hydration needs both to render the same
              tree, so every decision depends only on the modules. Two modules that import each
              other do not copy each other’s components.
            </p>
          </div>
        </div>
        <p>
          Set{' '}
          <a href="#option-optimizer-mode">
            <code>optimizer.mode</code>
          </a>{' '}
          to <code>'module'</code> to use module mode everywhere.
        </p>
      </Section>

      <Section id="cross-module" title="Constants across modules">
        <p>Both modes fold constants imported from other modules in the project.</p>
        <ul>
          <li>
            Each import is resolved and loaded by the bundler, so aliases, virtual modules, and
            plugins that rewrite the module are respected.
          </li>
          <li>
            A module with JSX is read from this plugin’s own output for it. It is skipped when it
            imports the importer, directly or through other modules of the project, since the two
            transforms would wait for each other.
          </li>
          <li>
            <code>define</code> entries and <code>import.meta.env</code> values fold in both modes,
            when every build environment gives them the same primitive value.{' '}
            <code>import.meta.env.SSR</code> never folds, since the server and client builds differ
            on it.
          </li>
          <li>Dependencies are not read, and nothing is read while serving.</li>
        </ul>
        <Compare
          before={`// config.ts
export const SHOW_BANNER = false;

// App.tsx
import { Show } from 'solid-js';
import { SHOW_BANNER } from './config';
import { Banner } from './Banner';

export function App() {
  return (
    <main>
      <Show when={SHOW_BANNER}>
        <Banner />
      </Show>
      <h1>Home</h1>
    </main>
  );
}`}
          after={`// App.tsx
import { Show } from 'solid-js';
import { SHOW_BANNER } from './config';
import { Banner } from './Banner';

export function App() {
  return (
    <main>
      <h1>Home</h1>
    </main>
  );
}

// Nothing uses Banner now, so the
// bundler leaves it out.`}
        />
      </Section>

      <Section id="vite-options" title="Options">
        <p>
          The plugin takes every option of <code>@solidjs/vite-plugin</code>, plus{' '}
          <code>optimizer</code>.
        </p>
        <Options options={VITE_OPTIONS} />
      </Section>

      <Section id="report" title="Report">
        <p>
          <code>optimizer.report</code> lists each component call, provider, and memo the optimizer
          left alone, grouped by reason. Turn it on when a component you expected to inline stays a
          component.
        </p>
        <Block code={REPORT_OUTPUT} lang="bash" />
        <p>
          Each line is a pass, a reason, how many times it happened, and the names it happened to. A
          function receives the report instead of printing it:
        </p>
        <Block code={REPORT_FUNCTION} />
        <p>
          A package’s own modules are compiled too, but what they leave alone is not reported, since
          the app cannot change it. The app’s calls of a package’s components are. In chunk mode, a
          chunk is reported as a whole, so it also lists the package code bundled into it.
        </p>
        <h3>Inline pass</h3>
        <Reasons reasons={INLINE_REASONS} />
        <h3>Provider and memo passes</h3>
        <Reasons reasons={OTHER_REASONS} />
        <p>
          The memo pass reports a few more reasons. See{' '}
          <a href={STRATEGY} target="_blank" rel="noopener noreferrer">
            strategy.md
          </a>{' '}
          for the exact rules of each pass.
        </p>
      </Section>

      <Section id="limits" title="Limits">
        <ul>
          <li>
            Chunk mode is skipped when the <code>babel</code> option is set or <code>compiler</code>{' '}
            is <code>'babel'</code>, since those passes need each module.
          </li>
          <li>
            An export named <code>__so_local$name</code> is added to a module for each local binding
            its exported components need, so a copy in another module can import it. In chunk mode,
            entry modules get none.
          </li>
          <li>
            A component used in several chunks is copied into each of them, where each copy is no
            larger than its call.
          </li>
          <li>
            Components from dependencies in <code>node_modules</code> are only copied from the
            packages <code>optimizer.packages</code> lists.
          </li>
          <li>
            <code>.tsrx</code> modules are lowered by the official plugin and are not optimized.
          </li>
        </ul>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const COMPILE = `import { compile } from 'solid-optimizer';

const result = compile(code, { filename: 'app.tsx' });

result.code;    // JSX, ready for Solid's JSX transform
result.map;     // a source map, or null when nothing changed
result.skipped; // what was left alone, when \`report\` is set`;

const COMPILE_THEN_LOWER = `import { transform } from '@solidjs/compiler';
import { compile } from 'solid-optimizer';

const optimized = compile(code, { filename: 'app.tsx' });
const output = transform(optimized.code, {
  filename: 'app.tsx',
  moduleName: '@solidjs/web',
  generate: 'dom',
});`;

const READ_CONSTANTS = `import { compile, readModuleConstants } from 'solid-optimizer';

const config = readModuleConstants(configCode, { filename: 'config.ts' });
config.exports; // { SHOW_BANNER: true, THEME: 'light' }
config.imports; // the modules it imports from

compile(appCode, {
  filename: 'app.tsx',
  importedConstants: { './config': config.exports },
});`;

const COMPILE_OPTIONS: Option[] = [
  {
    name: 'filename',
    type: 'string',
    default: "'input.jsx'",
    text: (
      <>
        Picks the parser and names the source in the source map. <code>.ts</code> and{' '}
        <code>.tsx</code> parse as TypeScript. Anything else parses as JSX.
      </>
    ),
  },
  {
    name: 'inline',
    type: 'boolean',
    default: 'true',
    text: (
      <>
        Replaces component calls with the component’s JSX. See{' '}
        <a href="#inline">Component inlining</a>.
      </>
    ),
  },
  {
    name: 'alwaysInline',
    type: 'boolean',
    default: 'false',
    text: (
      <>
        Inlines every component that can be, even where the copies are larger than the calls they
        replace. See <a href="#only-where-smaller">Only where it is smaller</a>.
      </>
    ),
  },
  {
    name: 'alwaysInlineComponents',
    type: 'string[]',
    default: '[]',
    text: (
      <>
        Top-level components to inline wherever they can be, like <code>alwaysInline</code> does for
        every component. The Vite plugin lists the copies from <code>optimizer.packages</code> here.
      </>
    ),
  },
  {
    name: 'contexts',
    type: 'boolean',
    default: 'true',
    text: (
      <>
        Removes context providers whose readers are all visible. See{' '}
        <a href="#contexts">Context inlining</a>.
      </>
    ),
  },
  {
    name: 'memos',
    type: 'boolean',
    default: 'true',
    text: (
      <>
        Replaces a memo that always makes a new value and is read once with its computation. See{' '}
        <a href="#memos">Memo inlining</a>.
      </>
    ),
  },
  {
    name: 'fold',
    type: 'boolean',
    default: 'true',
    text: (
      <>
        Folds constants, removes unreachable code, and resolves control flow whose props are
        constants. See <a href="#fold">Folding and control flow</a>.
      </>
    ),
  },
  {
    name: 'builtIns',
    type: 'string[]',
    default: "['For', 'Show', 'Switch', 'Match', …]",
    text: (
      <>
        The names of Solid’s built-in components. A tag only folds when it is one of them. An empty
        list turns control-flow folding off.
      </>
    ),
  },
  {
    name: 'moduleSources',
    type: 'string[]',
    default: "['solid-js', '@solidjs/web']",
    text: <>The modules Solid’s built-ins are imported from.</>,
  },
  {
    name: 'importedConstants',
    type: 'Record<string, Record<string, Primitive>>',
    text: (
      <>
        The constants of imported modules, keyed by the import specifier as the code writes it, then
        by export name. An import of one of them folds like a local <code>const</code>. See{' '}
        <a href="#read-module-constants">readModuleConstants</a>.
      </>
    ),
  },
  {
    name: 'globalConstants',
    type: 'Record<string, Primitive>',
    text: (
      <>
        Values of global names and paths, such as{' '}
        <code>{"{ __DEV__: false, 'import.meta.env.MODE': 'production' }"}</code>. A path starts at{' '}
        <code>import.meta</code> or at a name the module does not declare, and folds like a
        constant.
      </>
    ),
  },
  {
    name: 'sharedComponents',
    type: 'Record<string, number>',
    text: (
      <>
        Top-level components that other modules use too, by the number of modules that use them,
        this one included. Inlining one only counts its share of the declaration. <code>0</code>{' '}
        keeps the declaration whatever is inlined.
      </>
    ),
  },
  {
    name: 'maxPasses',
    type: 'number',
    default: '10',
    text: (
      <>
        The most rounds to run. One round can expose work for the next, such as an inlined component
        whose props now fold. Compilation stops early once a round changes nothing.
      </>
    ),
  },
  {
    name: 'sourceMap',
    type: 'boolean',
    default: 'true',
    text: <>Generates a source map.</>,
  },
  {
    name: 'report',
    type: 'boolean',
    default: 'false',
    text: (
      <>
        Records what the inline, provider, and memo passes leave alone, and why. The result lists
        them in <code>skipped</code>, each with its pass, a reason code, and a name. See{' '}
        <a href="#report">Report</a>.
      </>
    ),
  },
];

function Api(): JSX.Element {
  return (
    <>
      <Section id="compile" title="compile">
        <p>
          <code>compile(code, options)</code> optimizes one module, or a bundled chunk that kept its
          JSX. A chunk holds more components in one scope, so more of them inline.
        </p>
        <Block code={COMPILE} />
        <p>The output is still JSX. Run Solid’s JSX transform after it:</p>
        <Block code={COMPILE_THEN_LOWER} />
      </Section>

      <Section id="compile-options" title="compile options">
        <Options options={COMPILE_OPTIONS} />
      </Section>

      <Section id="read-module-constants" title="readModuleConstants">
        <p>
          <code>readModuleConstants</code> reads the constants a module exports, and the modules it
          imports from. Pass them to <code>compile</code> as <code>importedConstants</code>.
        </p>
        <Block code={READ_CONSTANTS} />
        <p>
          It keeps <code>export const</code> bindings whose value folds, a <code>let</code> the
          module never writes to, <code>export default</code> of a constant, and names exported from
          them. <code>import * as config</code> also works, as <code>config.NAME</code>. A module
          that re-exports constants from another module takes that module’s constants in its own{' '}
          <code>importedConstants</code>.
        </p>
        <p>The Vite plugin does all of this for you.</p>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

function Passes(): JSX.Element {
  return (
    <>
      <Section id="inline" title="Component inlining">
        <p>A component call is replaced with the component’s JSX.</p>
        <Compare
          before={`function Title(props) {
  return <h1 class="title">{props.label}</h1>;
}

export function App() {
  return (
    <main>
      <Title label="Hello" />
    </main>
  );
}`}
          after={`export function App() {
  return (
    <main>
      <h1 class="title">{'Hello'}</h1>
    </main>
  );
}`}
        />
        <p>
          Solid then creates one template for <code>&lt;main&gt;</code> instead of two.
        </p>
        <ul>
          <li>
            A read of <code>props.name</code> becomes the attribute’s expression. Solid passes
            dynamic props as getters, so the expression runs at every read, as before.
          </li>
          <li>
            A static prop that must be evaluated once, like a function read twice, is stored in a{' '}
            <code>const</code> first.
          </li>
          <li>
            <code>{'{props.children}'}</code>, and a prop whose value is JSX, splice their JSX in
            place so it joins the template.
          </li>
          <li>
            Statements in the component body move into the function whose returned JSX holds the
            call: a component, the child callback of <code>&lt;For&gt;</code> or{' '}
            <code>&lt;Repeat&gt;</code>, the child callback of <code>&lt;Show&gt;</code> or{' '}
            <code>&lt;Match&gt;</code> when it takes the value, or the callback given to{' '}
            <code>render</code>.
          </li>
          <li>Bindings declared in the component get fresh names in every copy.</li>
          <li>A component nothing else uses is removed, with any alias of it that nothing uses.</li>
        </ul>
        <h3>When a component inlines</h3>
        <ul>
          <li>
            It is declared once at the top level, with a capitalized name. A call through an alias,
            like <code>const Separator = SeparatorRoot</code>, is a call of the component it names.
            So is a call through a compound component, like Kobalte's{' '}
            <code>{'const Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger })'}</code>:{' '}
            <code>{'<Dialog>'}</code> calls <code>DialogRoot</code> and{' '}
            <code>{'<Dialog.Trigger>'}</code> calls <code>DialogTrigger</code>, as long as nothing
            writes to a member of either.
          </li>
          <li>
            Its parameter is one identifier that is only read as <code>props.name</code>, spread
            onto an element as <code>{'{...props}'}</code>, or passed to <code>merge()</code> and{' '}
            <code>omit()</code>.
          </li>
          <li>
            Its body ends in the only <code>return</code>, and that <code>return</code> returns JSX.
          </li>
          <li>
            It does not use <code>this</code>, <code>arguments</code>, <code>super</code>, or{' '}
            <code>new.target</code>.
          </li>
          <li>The call site has no spread attribute and no namespaced attribute.</li>
          <li>
            A <code>ref</code> at the call site moves to the element the component gives{' '}
            <code>props.ref</code> to, when its value is a name, a function, or an array of them. In
            an array, <code>void 0</code> and <code>untrack(() =&gt; ...)</code> around a name or a
            function count too.
          </li>
        </ul>
        <h3>Props with defaults</h3>
        <p>
          The props can go through <code>merge()</code> and <code>omit()</code> first, declared as a{' '}
          <code>const</code> in the component:
        </p>
        <Block
          code={`function Button(props) {
  const merged = merge({ type: 'button' }, props);
  const rest = omit(merged, 'label');
  return <button {...rest}>{props.label}</button>;
}`}
        />
        <ul>
          <li>
            A default has to be a literal, like <code>'button'</code>, <code>0</code>, or{' '}
            <code>false</code>.
          </li>
          <li>
            <code>omit()</code> has to name its keys as string literals.
          </li>
          <li>
            A view can only be read as <code>view.name</code>, spread onto an element, or passed to
            another <code>merge()</code> or <code>omit()</code>.
          </li>
          <li>
            A spread becomes the attributes the call site passes, and it cannot repeat an attribute
            the element already has.
          </li>
        </ul>
        <h3 id="only-where-smaller">Only where it is smaller</h3>
        <p>
          Every copy repeats the component’s own code, so inlining a component at many calls can
          make the output larger. Before inlining, each component’s copies are compared with what
          they replace, as Solid’s JSX transform would lower them. A copy saves the component call
          and the getters of its props. It costs the component’s statements, its dynamic attributes
          and children, and the elements that cannot join a template.
        </p>
        <p>
          A small component, or one used once, inlines at every call. A wrapper used many times,
          whose root is another component, stays a component. Set{' '}
          <a href="#option-alwaysInline">
            <code>alwaysInline</code>
          </a>{' '}
          to inline every component that can be.
        </p>
        <p>
          The estimate weighs each component on its own, so it cannot see runtime code that only
          goes once every call that needs it is inlined, like <code>&lt;Dynamic&gt;</code>,{' '}
          <code>merge()</code>, and <code>omit()</code> behind a headless library’s components. In
          chunk mode, each chunk is also built with every component inlined that can be, and the
          smaller one, minified and gzipped, is kept.
        </p>
        <h3>Accepted differences</h3>
        <ul>
          <li>
            A prop called as <code>props.name()</code> runs with its own receiver as{' '}
            <code>this</code>, not the props object.
          </li>
          <li>
            Moved statements run before the host’s JSX is created. The order of effect registration
            between siblings can change.
          </li>
        </ul>
      </Section>

      <Section id="contexts" title="Context inlining">
        <p>
          A context provider whose readers are all visible is removed, and each read gets the
          provider’s value.
        </p>
        <Compare
          before={`const Theme = createContext();

function Label() {
  const theme = useContext(Theme);
  return <span class={theme}>label</span>;
}

export function App() {
  return (
    <main>
      <Theme value="dark">
        <Label />
      </Theme>
    </main>
  );
}`}
          after={`export function App() {
  const theme$1 = 'dark';
  return (
    <main>
      <span class={'dark'}>label</span>
    </main>
  );
}`}
        />
        <ul>
          <li>
            Everything under the provider has to be visible: intrinsic elements, Solid’s built-ins,
            and components that inline. A call to an unknown function, or a read of a component’s{' '}
            <code>props</code>, keeps the provider.
          </li>
          <li>
            An object value is stored in a <code>const</code> once, so every reader gets the same
            object.
          </li>
          <li>
            The value must never be <code>undefined</code>.
          </li>
          <li>
            Removing the provider removes its owner, so the hydration keys change. See{' '}
            <a href="#hydration">Hydration</a>.
          </li>
        </ul>
      </Section>

      <Section id="memos" title="Memo inlining">
        <p>
          A <code>createMemo</code> whose result is new on every run, such as an object, array, or
          JSX, never stops an update. When it is also read once, as the whole of a tracked JSX
          expression, the read runs the computation itself.
        </p>
        <Compare
          before={`const style = createMemo(() => ({ color: color() }));
return <p style={style()} />;`}
          after={`return <p style={{ color: color() }} />;`}
        />
        <p>
          A memo whose computation folds to a literal never changes. Every call of it becomes the
          literal, when each call comes after the declaration and nothing else uses the memo.
        </p>
        <Compare
          before={`const size = createMemo(() => 1 + 2);
return <p>{size() * 2}</p>;`}
          after={`return <p>{6}</p>;`}
        />
        <p>
          Solid’s <code>children</code> helper over JSX, read once as an element’s child, becomes
          that JSX. This is what a component that calls{' '}
          <code>children(() =&gt; props.children)</code> leaves once it is inlined with JSX
          children.
        </p>
      </Section>

      <Section id="fold" title="Folding and control flow">
        <p>
          This follows the <code>optimize</code> option of <code>@solidjs/compiler</code>.
        </p>
        <ul>
          <li>
            Constant expressions fold, including <code>const</code> bindings and <code>let</code>{' '}
            bindings nothing writes to, at any scope.
          </li>
          <li>
            Branches that a constant condition never takes are removed. So are statements after a{' '}
            <code>return</code>, <code>throw</code>, <code>break</code>, or <code>continue</code>.
          </li>
          <li>
            <code>&lt;Show when&gt;</code> becomes its children or its <code>fallback</code>.
          </li>
          <li>
            <code>&lt;For each&gt;</code> becomes its <code>fallback</code> when <code>each</code>{' '}
            is an empty array literal or a falsy constant.
          </li>
          <li>
            <code>&lt;Repeat count&gt;</code> becomes its <code>fallback</code> when{' '}
            <code>count</code> is below one.
          </li>
          <li>
            <code>&lt;Switch&gt;</code> drops each <code>&lt;Match&gt;</code> that is always false,
            and becomes the first <code>&lt;Match&gt;</code> that is always true.
          </li>
          <li>
            <code>&lt;Dynamic component="div"&gt;</code> becomes <code>&lt;div&gt;</code>.{' '}
            <code>&lt;Dynamic component={'{Card}'}&gt;</code> becomes <code>&lt;Card&gt;</code> when{' '}
            <code>Card</code> is a capitalized component declared at the top level that nothing
            reassigns.
          </li>
          <li>
            <code>untrack(() =&gt; value)</code> becomes the value when the value is a constant.
          </li>
          <li>
            A call of an arrow function whose body is JSX, such as a render prop left by inlining,
            becomes the JSX when it is an element’s child and each argument is a constant or a
            binding nothing reassigns.
          </li>
        </ul>
        <h3>Constant lists</h3>
        <p>
          <code>&lt;For&gt;</code> over a constant list becomes one copy of its row per item, when
          the copies are estimated to be no larger than the loop.
        </p>
        <Compare
          before={`const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
];

<nav>
  <For each={LINKS}>
    {(link) => <a href={link.href}>{link.label}</a>}
  </For>
</nav>`}
          after={`<nav>
  <a href={'/'}>{'Home'}</a>
  <a href={'/docs'}>{'Docs'}</a>
</nav>`}
        />
        <ul>
          <li>
            The list is an array literal, or a <code>const</code> of one that only{' '}
            <code>&lt;For&gt;</code> reads and that is not exported.
          </li>
          <li>Each item is a primitive literal, or an object literal of them.</li>
          <li>
            The row is an arrow function whose body is JSX without a <code>ref</code> or a spread,
            and reads the item as <code>item.key</code>, or as itself when it is a primitive.
          </li>
          <li>Each row had its own owner, so this shifts the hydration keys after it.</li>
        </ul>
        <h3>What never folds</h3>
        <p>
          A built-in only folds when the tag resolves to Solid’s component: it binds to nothing, or
          is imported from one of <code>moduleSources</code>. A tag with a spread attribute or a
          function child never folds. <code>&lt;Portal&gt;</code>, <code>&lt;Loading&gt;</code>,{' '}
          <code>&lt;Errored&gt;</code>, and <code>&lt;Reveal&gt;</code> never fold.
        </p>
        <p>
          A call to Solid’s <code>lazy</code> is marked <code>/* @__PURE__ */</code>, so the bundler
          drops one that a folded branch left unused, along with its chunk. A condition that is
          discarded but has side effects still runs: <code>[effect()] &amp;&amp; value</code>{' '}
          becomes <code>([effect()], value)</code>.
        </p>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// The line below the sticky header (and the folded contents on narrow
// screens) that a section has to pass to become current.
const CURRENT_LINE = 160;

/** Marks the sidebar entry of the section at the top of the screen. */
function trackCurrent(setCurrent: (id: string) => void): () => void {
  const sections = [...document.querySelectorAll<HTMLElement>('.doc-section')];
  let frame = 0;

  function update(): void {
    frame = 0;
    const root = document.documentElement;
    // At the bottom of the page the last section wins, even when it is short.
    if (window.scrollY + window.innerHeight >= root.scrollHeight - 2) {
      const last = sections.at(-1);
      if (last) {
        setCurrent(last.id);
      }
      return;
    }
    // Otherwise the last section whose top passed the line wins.
    let current = sections.at(0);
    for (const section of sections) {
      if (section.getBoundingClientRect().top > CURRENT_LINE) {
        break;
      }
      current = section;
    }
    if (current) {
      setCurrent(current.id);
    }
  }

  function schedule(): void {
    if (!frame) {
      frame = requestAnimationFrame(update);
    }
  }

  update();
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
  };
}

function label(id: string): string {
  for (const group of NAVIGATION) {
    for (const entry of group.entries) {
      if (entry.id === id) {
        return entry.label;
      }
    }
  }
  return 'Contents';
}

export function Docs(): JSX.Element {
  const [current, setCurrent] = createSignal('introduction');

  // On narrow screens the contents fold into a menu, which closes after a pick.
  function close(event: MouseEvent): void {
    const toc =
      event.currentTarget instanceof Element ? event.currentTarget.closest('details') : null;
    if (toc && event.target instanceof HTMLAnchorElement) {
      toc.open = false;
    }
  }

  onSettled(() =>
    trackCurrent((id) => {
      setCurrent(id);
    }),
  );

  return (
    <>
      <Header page="docs" />
      <div class="docs">
        <details class="docs-toc">
          <summary>{label(current())}</summary>
          <nav class="docs-nav" aria-label="Documentation" onClick={close}>
            <For each={NAVIGATION}>
              {(group) => (
                <div class="docs-nav-group">
                  <span class="docs-nav-title">{group.title}</span>
                  <For each={group.entries}>
                    {(entry) => (
                      <a
                        href={`#${entry.id}`}
                        class={{ current: current() === entry.id }}
                        aria-current={current() === entry.id ? 'location' : undefined}
                      >
                        {entry.label}
                      </a>
                    )}
                  </For>
                </div>
              )}
            </For>
          </nav>
        </details>
        <main class="docs-content">
          <h1 class="docs-title">Documentation</h1>
          <GettingStarted />
          <h2 class="docs-part">Vite plugin</h2>
          <VitePlugin />
          <h2 class="docs-part">API</h2>
          <Api />
          <h2 class="docs-part">Passes</h2>
          <Passes />
        </main>
      </div>
      <Footer />
    </>
  );
}
