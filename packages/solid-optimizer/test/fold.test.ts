/**
 * The fold pass. These follow the tests of the `optimize` option in
 * `@solidjs/compiler` (https://github.com/solidjs/solid/pull/3231), checked on
 * the JSX this package emits and on what Solid's JSX transform makes of it.
 */
import { describe, expect, it } from 'vitest';
import { lower, optimize } from './utils';

function folded(code: string): string {
  return optimize(code, { inline: false });
}

function lowered(code: string): string {
  return lower(folded(code));
}

describe('control-flow components', () => {
  it('resolves <Show> to the branch a constant condition selects', () => {
    expect(folded('const view = <Show when={true}><div>on</div></Show>;')).toBe(
      'const view = <div>on</div>;',
    );
    expect(folded('const view = <Show when={false}><div>on</div></Show>;')).toBe(
      'const view = null;',
    );
    expect(folded('const view = <Show when={0} fallback={<span>off</span>}><div /></Show>;')).toBe(
      'const view = <span>off</span>;',
    );
    expect(lowered('const view = <Show when={true}><div>on</div></Show>;')).not.toContain(
      'createComponent',
    );
  });

  it('folds <Show> against a module-level constant', () => {
    const code = lowered(
      'const DEBUG = false;\nexport const view = <div><Show when={DEBUG}><b /></Show></div>;',
    );
    expect(code).not.toContain('<b');
    expect(code).not.toContain('createComponent');

    // A reassigned binding is not a constant.
    expect(
      lowered(
        'let DEBUG = false;\nDEBUG = true;\nexport const view = <div><Show when={DEBUG}><b /></Show></div>;',
      ),
    ).toContain('createComponent');
  });

  it('keeps <Show> with function children or a spread', () => {
    expect(lowered('const view = <Show when={true}>{v => <div>{v()}</div>}</Show>;')).toContain(
      'createComponent',
    );
    expect(lowered('const view = <Show when={true} {...rest}><div /></Show>;')).toContain(
      'createComponent',
    );
  });

  it('resolves <For> over an empty list to its fallback', () => {
    expect(
      folded('const view = <For each={[]} fallback={<span>none</span>}>{i => <li />}</For>;'),
    ).toBe('const view = <span>none</span>;');
    expect(folded('const view = <For each={null}>{i => <li />}</For>;')).toBe('const view = null;');
    expect(lowered('const view = <For each={items()}>{i => <li />}</For>;')).toContain(
      'createComponent',
    );
  });

  it('resolves <Repeat> with a count below one to its fallback', () => {
    expect(
      folded('const view = <Repeat count={0} fallback={<span>none</span>}>{i => <li />}</Repeat>;'),
    ).toBe('const view = <span>none</span>;');
    expect(lowered('const view = <Repeat count={3}>{i => <li />}</Repeat>;')).toContain(
      'createComponent',
    );
  });

  it('resolves <Switch> to its first statically true <Match>', () => {
    expect(
      folded(
        'const view = <Switch fallback={<a />}><Match when={false}><b /></Match><Match when={true}><i /></Match></Switch>;',
      ),
    ).toBe('const view = <i />;');
    expect(
      folded('const view = <Switch fallback={<a />}><Match when={false}><b /></Match></Switch>;'),
    ).toBe('const view = <a />;');

    // An undecided match before a true one blocks the pick, but the dead match still goes.
    const pruned = folded(
      'const view = <Switch><Match when={maybe()}><b /></Match><Match when={false}><u /></Match></Switch>;',
    );
    expect(pruned).toBe('const view = <Switch><Match when={maybe()}><b /></Match></Switch>;');
  });

  it('turns <Dynamic> with a static intrinsic tag into the element', () => {
    expect(folded('const view = <Dynamic component="div" id="main" />;')).toBe(
      'const view = <div id="main" />;',
    );
    expect(lowered('const view = <Dynamic component="div" id="main" />;')).toContain(
      '_$template(`<div id=main>',
    );
    expect(
      folded('const TAG = "section";\nconst view = <Dynamic component={TAG}>x</Dynamic>;'),
    ).toBe('const TAG = "section";\nconst view = <section>x</section>;');
    expect(lowered('const view = <Dynamic component={Widget} id="main" />;')).toContain(
      'createComponent',
    );
  });

  it('splices a resolved child into the surrounding template', () => {
    expect(folded('const view = <div>a<Show when={true}><b /></Show>c</div>;')).toBe(
      'const view = <div>a<b />c</div>;',
    );
    expect(
      folded('const view = <div>a<Show when={false} fallback={x()}><b /></Show>c</div>;'),
    ).toBe('const view = <div>a{x()}c</div>;');
  });

  it('keeps text that was apart from merging into one text node', () => {
    // JSX trims a text node as a whole, so `a` and `c` on their own lines
    // render as `ac` only while something separates them.
    const code = folded('const view = <div>\n  a\n  <Show when={false}><b /></Show>\n  c\n</div>;');
    expect(code).toBe('const view = <div>\n  a\n  {}\n  c\n</div>;');
    expect(lower(code)).toContain('_$template(`<div>ac`)');

    const spliced = folded(
      'const view = <div>\n  a\n  <Show when={true}>\n    b\n  </Show>\n  c\n</div>;',
    );
    expect(lower(spliced)).toContain('_$template(`<div>abc`)');
  });

  it('ignores comment children when picking what a fold renders', () => {
    expect(folded('const view = <Show when={true}>{/* note */}<div /></Show>;')).toBe(
      'const view = <div />;',
    );
  });

  it('splices a fragment that is a JSX child', () => {
    const code = folded('const view = <div>a<><b />c</>d</div>;');
    expect(code).toBe('const view = <div>a<b />c{}d</div>;');
    expect(lower(code)).toContain('_$template(`<div>a<b></b>cd`)');
  });

  it('only folds a tag that resolves to Solid’s component', () => {
    expect(
      lowered('import { Show } from "solid-js";\nconst view = <Show when={true}><div /></Show>;'),
    ).not.toContain('createComponent');
    expect(
      lowered(
        'import { Show } from "@solidjs/web";\nconst view = <Show when={true}><div /></Show>;',
      ),
    ).not.toContain('createComponent');
    expect(
      lowered(
        'import { Show as Cond } from "solid-js";\nconst view = <Cond when={true}><div /></Cond>;',
      ),
    ).not.toContain('createComponent');
    expect(
      lowered(
        'import { For as Each } from "solid-js";\nconst view = <Each each={[]} fallback={<span />}>{i => <li />}</Each>;',
      ),
    ).not.toContain('createComponent');

    expect(
      lowered('import { Show } from "./my-show";\nconst view = <Show when={true}><div /></Show>;'),
    ).toContain('createComponent');
    expect(
      lowered(
        'import { Show as Cond } from "./my-show";\nconst view = <Cond when={true}><div /></Cond>;',
      ),
    ).toContain('createComponent');
    expect(
      lowered(
        'import { Reveal as Show } from "solid-js";\nconst view = <Show when={true}><div /></Show>;',
      ),
    ).toContain('createComponent');
    expect(
      lowered(
        'function App() {\n  const Show = props => props.children;\n  return <Show when={true}><div /></Show>;\n}',
      ),
    ).toContain('createComponent');
  });

  it('lets a local binding shadow a Solid import in its own scope', () => {
    const code = folded(
      'import { Show } from "solid-js";\nexport function App() {\n  const Show = props => props.children;\n  return <Show when={true}><b /></Show>;\n}\nexport const view = <Show when={true}><i /></Show>;',
    );
    expect(code).toContain('return <Show when={true}><b /></Show>;');
    expect(code).toContain('export const view = <i />;');
  });

  it('never folds components that wait on runtime state', () => {
    for (const tag of ['Portal', 'Loading', 'Errored', 'Reveal']) {
      const code = `const view = <${tag} when={false}><div /></${tag}>;`;
      expect(folded(code)).toBe(code);
    }
  });

  it('can be turned off with an empty builtIns list', () => {
    const code = 'const view = <Show when={false}><div /></Show>;';
    expect(optimize(code, { inline: false, builtIns: [] })).toBe(code);
  });

  it('keeps a component prop that has side effects', () => {
    // Solid reads `when` inside a memo, so evaluating it here would change when it runs.
    expect(lowered('export const v = <Show when={[effect()]}><b /></Show>;')).toContain(
      'createComponent',
    );
    expect(lowered('export const l = <For each={effects() && null}><b /></For>;')).toContain(
      'effects()',
    );
  });
});

describe('constants', () => {
  it('folds constant expressions into attributes', () => {
    expect(folded('const view = <div id={"a" + "b"} tabindex={1 + 2} />;')).toBe(
      'const view = <div id={"ab"} tabindex={3} />;',
    );
    const code = lowered('const view = <div id={"a" + "b"} tabindex={1 + 2} />;');
    expect(code).toContain('id=ab');
    expect(code).toContain('tabindex=3');
  });

  it('folds constants declared in any scope', () => {
    expect(
      lowered(
        'export function App() {\n  const DEBUG = false;\n  return <div><Show when={DEBUG}><b>panel</b></Show></div>;\n}',
      ),
    ).not.toContain('panel');
    expect(
      lowered(
        'export function App() {\n  const N = 2;\n  const render = () => <div><Show when={N > 1}><b>panel</b></Show></div>;\n  return render();\n}',
      ),
    ).not.toContain('createComponent');

    // An unwritten `let` is a constant. A written one is not.
    expect(
      lowered(
        'export function App() {\n  let DEBUG = false;\n  return <Show when={DEBUG}><b /></Show>;\n}',
      ),
    ).not.toContain('createComponent');
    expect(
      lowered(
        'export function App() {\n  let DEBUG = false;\n  DEBUG = flag();\n  return <Show when={DEBUG}><b /></Show>;\n}',
      ),
    ).toContain('createComponent');

    // A parameter shadows the outer constant.
    expect(
      lowered(
        'const DEBUG = false;\nexport function App(DEBUG) {\n  return <Show when={DEBUG}><b /></Show>;\n}',
      ),
    ).toContain('createComponent');

    // Two unrelated bindings of the same name resolve on their own.
    const independent = lowered(
      'export function A() {\n  const FLAG = true;\n  return <Show when={FLAG}><b /></Show>;\n}\nexport function B(FLAG) {\n  return <Show when={FLAG}><i /></Show>;\n}',
    );
    expect(independent).toContain('<b');
    expect(independent).toContain('createComponent');

    // A declaration does not reach a reference outside its scope.
    expect(
      lowered(
        'function inner() {\n  const OUTSIDE = false;\n  return OUTSIDE;\n}\nexport const view = <Show when={OUTSIDE}><b /></Show>;',
      ),
    ).toContain('createComponent');

    // A use above its declaration still folds, since the function runs later.
    expect(
      lowered(
        'export function App() {\n  return <Show when={DEBUG}><b /></Show>;\n}\nconst DEBUG = false;',
      ),
    ).not.toContain('createComponent');
  });

  it('folds bindings that refer to each other', () => {
    // `A` reads `B` before it is declared, which throws at runtime. Folding
    // turns that into a value, the one deviation the fold accepts.
    expect(folded('const A = B;\nconst B = 1;\nexport const x = A;')).toBe(
      'const A = 1;\nconst B = 1;\nexport const x = 1;',
    );
    expect(folded('const B = 1;\nconst A = B + 1;\nexport const x = A;')).toBe(
      'const B = 1;\nconst A = 2;\nexport const x = 2;',
    );
  });

  it('does not fold var bindings', () => {
    expect(folded('var A = 1;\nexport const x = A;')).toBe('var A = 1;\nexport const x = A;');
  });

  it('keeps output valid where a literal needs parentheses', () => {
    expect(folded('const N = 5;\nexport const s = N.toFixed();')).toBe(
      'const N = 5;\nexport const s = (5).toFixed();',
    );
    expect(folded('const N = -1;\nexport const s = 1 - N;')).toBe(
      'const N = -1;\nexport const s = 2;',
    );
    expect(folded('const N = -1;\nexport const s = x - N;')).toBe(
      'const N = -1;\nexport const s = x - (-1);',
    );
    expect(folded('const ENABLED = true;\nexport const o = { ENABLED };')).toBe(
      'const ENABLED = true;\nexport const o = { ENABLED: true };',
    );
    expect(folded('const S = "use strict";\nfunction f() {\n  S;\n}')).toBe(
      'const S = "use strict";\nfunction f() {\n  ("use strict");\n}',
    );
  });

  it('leaves exports and tagged templates alone', () => {
    expect(folded('const A = 1;\nexport { A };')).toBe('const A = 1;\nexport { A };');
    // The code under test is a template literal, so the placeholders are meant as text.
    // oxlint-disable-next-line no-template-curly-in-string
    expect(folded('export const t = tag`a${1 + 1}`;')).toBe('export const t = tag`a${2}`;');
  });

  it('matches the engine on operator edge cases', () => {
    expect(
      folded('export const x = [1 ** Infinity, 5 % 0, "2" * "3", "10" < "9", null + 1];'),
    ).toBe('export const x = [1 ** Infinity, 5 % 0, 6, true, 1];');
  });
});

describe('dead code', () => {
  it('removes a branch a constant condition never takes', () => {
    expect(folded('function App() {\n  if (false) { missing(); }\n  return <div />;\n}')).toBe(
      'function App() {\n  \n  return <div />;\n}',
    );
    expect(folded('function App() {\n  if (true) { kept(); } else { gone(); }\n}')).toBe(
      'function App() {\n  { kept(); }\n}',
    );
  });

  it('removes statements after a return', () => {
    expect(folded('function App() {\n  return <div />;\n  unreachable();\n}')).toBe(
      'function App() {\n  return <div />;\n  \n}',
    );
  });

  it('keeps a branch with a hoisted declaration', () => {
    const code = 'function App() {\n  if (false) { var kept = 1; }\n  return <div />;\n}';
    expect(folded(code)).toBe(code);
    const after = 'function App() {\n  return <div />;\n  function helper() {}\n}';
    expect(folded(after)).toBe(after);
  });

  it('keeps the side effects of a discarded condition', () => {
    expect(folded('export const x = [effect()] && other;')).toBe(
      'export const x = ([effect()], other);',
    );
    expect(folded('export const y = { k: effect() } ? a : b;')).toBe(
      'export const y = ({ k: effect() }, a);',
    );
    expect(folded('export const n = ([effect()] && false) ? a : b;')).toContain('[effect()], b');
    expect(folded('export const s = [...iterable()] ? a : b;')).toContain('iterable()');
    expect(folded('export const c = { [key()]: 1 } ? a : b;')).toContain('key()');
    expect(folded('export const z = (class { static { effect(); } }) ? a : b;')).toContain(
      'effect()',
    );
    expect(folded('export const w = (class extends base() {}) ? a : b;')).toContain('base()');

    const branch = folded(
      'export function App() {\n  if ({ k: effect() }) { taken(); }\n  else { gone(); }\n  return <div />;\n}',
    );
    expect(branch).toContain('({ k: effect() });');
    expect(branch).toContain('taken()');
    expect(branch).not.toContain('gone()');

    const loop = folded(
      'export function App() {\n  while ([effect()] && false) { body(); }\n  return <div />;\n}',
    );
    expect(loop).toContain('effect()');
    expect(loop).not.toContain('body()');
    expect(loop).not.toContain('while');
  });

  it('drops the side of a short-circuit that never runs', () => {
    expect(folded('export const k = false && effect();')).toBe('export const k = false;');
    expect(folded('export const j = true ? kept() : effect();')).toBe('export const j = kept();');
  });
});

describe('server parity', () => {
  it('folds the same way for SSR', () => {
    const code = folded('const view = <div><Show when={false}><b /></Show><i /></div>;');
    const ssr = lower(code, 'ssr');
    expect(ssr).not.toContain('<b');
    expect(ssr).toContain('<i');
  });
});
