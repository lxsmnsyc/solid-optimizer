/**
 * Generated tests for the whole compiler. Each case is a small module of
 * components built from constants, signals that nothing writes, derived
 * arrows, memos, `<Show>`, `<For>`, and props, the shapes the passes fold.
 *
 * The plain module is the oracle: rendered on the server, the optimized
 * module has to give the same HTML.
 */
import { fc, test } from '@fast-check/vitest';
import { runInThisContext } from 'node:vm';
import { transform } from '@solidjs/compiler';
import * as web from '@solidjs/web';
import { parseFragment, serialize } from 'parse5';
import * as solid from 'solid-js';
import { expect } from 'vitest';
import './fc';
import { parse } from '../src/ast';
import { optimize } from './utils';

// No string holds `<` or `&`. Solid's server build does not escape a string
// literal in a branch of a ternary, so `{a() ? 0 : "<i>"}` renders an element
// on the server and text on the client, with or without this package.
const literal = fc.constantFrom(
  '0',
  '1',
  '2',
  '-1',
  '0.5',
  'true',
  'false',
  'null',
  'undefined',
  '""',
  '"a"',
  '"b c"',
  '"q>"',
  "'x'",
  '`t`',
);

const text = fc.constantFrom('a', 'b c', ' ', '&amp;', '&lt;b&gt;', "it's", '"q"', '\n  x\n  ');

/** Expressions over the given references, such as `count()` or `props.tone`. */
function expressionOf(leaves: readonly string[]): fc.Arbitrary<string> {
  const leaf = leaves.length > 0 ? fc.oneof(literal, fc.constantFrom(...leaves)) : literal;
  const { expression } = fc.letrec<{ expression: string }>((tie) => ({
    expression: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      leaf,
      fc
        .tuple(tie('expression'), fc.constantFrom('+', '===', '&&', '||', '??'), tie('expression'))
        .map(([a, op, b]) => `(${a}) ${op} (${b})`),
      fc
        .tuple(tie('expression'), tie('expression'), tie('expression'))
        .map(([a, b, c]) => `(${a}) ? (${b}) : (${c})`),
      tie('expression').map((a) => `\`[\${${a}}]\``),
      tie('expression').map((a) => `!(${a})`),
    ),
  }));
  return expression;
}

/** JSX children over the given references. */
function childrenOf(leaves: readonly string[], components: boolean): fc.Arbitrary<string> {
  const expression = expressionOf(leaves);
  const { children } = fc.letrec<{ child: string; children: string }>((tie) => ({
    child: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      text,
      expression.map((a) => `{${a}}`),
      // Phrasing elements only, so the source itself never nests invalid HTML.
      fc
        .tuple(fc.constantFrom('b', 'span', 'em'), expression, tie('children'))
        .map(([tag, a, inner]) => `<${tag} class={${a}} title="t">${inner}</${tag}>`),
      fc
        .tuple(expression, tie('children'), fc.option(tie('children'), { nil: undefined }))
        .map(([when, inner, fallback]) =>
          fallback === undefined
            ? `<Show when={${when}}>${inner}</Show>`
            : `<Show when={${when}} fallback={<>${fallback}</>}>${inner}</Show>`,
        ),
      fc
        .tuple(fc.array(literal, { maxLength: 3 }), tie('children'))
        .map(
          ([items, inner]) =>
            `<For each={[${items.join(', ')}]}>{(item) => <i>{item}${inner}</i>}</For>`,
        ),
      ...(components
        ? [
            fc
              .tuple(expression, expression)
              .map(([tone, label]) => `<Badge tone={${tone}} label={${label}} />`),
            tie('children').map((inner) => `<Row>${inner}</Row>`),
          ]
        : []),
    ),
    children: fc.array(tie('child'), { maxLength: 3 }).map((parts) => parts.join('')),
  }));
  return children;
}

const MODULE = ['K', 'LABEL'];
const APP = [...MODULE, 'count()', 'name()'];

const program = fc
  .record({
    k: literal,
    label: literal,
    count: literal,
    name: literal,
    derived: expressionOf(APP),
    memo: expressionOf([...APP, 'derived()']),
    badge: childrenOf([...MODULE, 'props.tone', 'props.label'], false),
    app: childrenOf([...APP, 'derived()', 'total()'], true),
  })
  .map(
    (parts) => `import { createMemo, createSignal, For, Show } from 'solid-js';

const K = ${parts.k};
const LABEL = ${parts.label};

function Badge(props) {
  return <span class={props.tone}>${parts.badge}</span>;
}

function Row(props) {
  return <li>{props.children}</li>;
}

export function App() {
  const [count] = createSignal(${parts.count});
  const [name, setName] = createSignal(${parts.name});
  const derived = () => ${parts.derived};
  const total = createMemo(() => ${parts.memo});
  return <div onClick={() => setName('clicked')}>${parts.app}</div>;
}
`,
  );

// Each property compiles 100 modules several times, which takes seconds on a busy machine.
const TIMEOUT = process.env.FC_RUNS === undefined ? 60_000 : 0;

const MODULES: Record<string, unknown> = { 'solid-js': solid, '@solidjs/web': web };

/**
 * Runs a lowered module and returns its `App`. Imports become lookups in
 * `MODULES`, so a case needs no file and no module loader.
 */
function loadApp(lowered: string): () => unknown {
  let body = lowered.replaceAll(
    /^import \{([^}]*)\} from ["']([^"']+)["'];$/gm,
    (_, names: string, source: string) =>
      `const {${names.replaceAll(' as ', ': ')}} = modules[${JSON.stringify(source)}];`,
  );
  body = body.replace('export function App', 'function App');
  expect(body).not.toMatch(/^(import|export) /m);
  const load: unknown = runInThisContext(`(function (modules) {\n${body}\nreturn App;\n})`);
  if (typeof load !== 'function') {
    throw new TypeError('the lowered module did not load');
  }
  const app: unknown = Reflect.apply(load, undefined, [MODULES]);
  if (typeof app !== 'function') {
    throw new TypeError('the lowered module has no App');
  }
  return () => Reflect.apply(app, undefined, []) as unknown;
}

/**
 * Lowers a module for the server and renders `App`. Comment markers are left
 * out, since the passes remove the inserts they mark.
 */
function render(code: string): string {
  const lowered = transform(code, {
    filename: 'input.jsx',
    moduleName: '@solidjs/web',
    generate: 'ssr',
    hydratable: false,
  }).code;
  const app = loadApp(lowered);
  const html = web.renderToString(app).replaceAll(/<!--.*?-->/g, '');
  // Parsing and serializing again spells the same tree one way, so `&gt;`
  // and `>` in text, or `class` and `class=""`, compare equal. Solid's server
  // writes `class=""` for a dynamic `class={false}`, where the client writes
  // no attribute, and a folded `false` writes none either.
  return serialize(parseFragment(html)).replaceAll(' class=""', '');
}

test.prop([program])(
  'the optimized module parses, and Solid lowers it',
  (code) => {
    for (const alwaysInline of [false, true]) {
      const optimized = optimize(code, { alwaysInline });
      expect(() => parse('output.jsx', optimized)).not.toThrow();
      expect(() =>
        transform(optimized, {
          filename: 'output.jsx',
          moduleName: '@solidjs/web',
          generate: 'dom',
        }),
      ).not.toThrow();
    }
  },
  TIMEOUT,
);

test.prop([program])(
  'the optimized module renders the same HTML on the server',
  (code) => {
    const expected = render(code);
    for (const alwaysInline of [false, true]) {
      const optimized = optimize(code, { alwaysInline });
      expect(render(optimized), `alwaysInline: ${String(alwaysInline)}`).toBe(expected);
      // A second compile can take what the first one left, like a <For> whose row held a <Show>.
      expect(render(optimize(optimized, { alwaysInline })), 'optimized twice').toBe(expected);
    }
  },
  TIMEOUT,
);
