import { describe, expect, it } from 'vitest';
import type { CompileOptions, Skip } from '../src';
import { compile } from '../src';
import { formatReport, summarizeSkips } from '../src/vite/report';

const IMPORTS = `import { createContext, createMemo, createSignal, For, lazy, useContext } from 'solid-js';\n`;

function skipped(code: string, options: CompileOptions = {}): Skip[] {
  return compile(IMPORTS + code, { sourceMap: false, report: true, ...options }).skipped ?? [];
}

function reasons(code: string, options: CompileOptions = {}): string[] {
  return skipped(code, options).map((skip) => `${skip.pass}:${skip.reason}:${skip.name}`);
}

describe('skip report', () => {
  it('is only collected when asked for', () => {
    const result = compile(`${IMPORTS}export const A = () => <Box {...p} />;`, {
      sourceMap: false,
    });
    expect(result.skipped).toBeUndefined();
  });

  it('reports nothing once every call is inlined', () => {
    expect(
      reasons(`function Title(props) { return <h1>{props.label}</h1>; }
export const A = () => <main><Title label="a" /></main>;`),
    ).toEqual([]);
  });

  it('gives the reason a component is turned down at each call', () => {
    expect(
      reasons(
        `function Box(props) { return <div {...props} />; }
function Pair({ a }) { return <b>{a}</b>; }
async function Later() { return <i />; }
function Maybe(props) { if (props.x) { return null; } return <i />; }
function Self(props) { return <ul><Self /></ul>; }
const Page = lazy(() => import('./page'));
export const A = () => <main><Box id="a" /><Pair a="x" /><Later /><Maybe /><Self /><Page /></main>;`,
        { fold: false },
      ),
    ).toEqual([
      // In source order, so the call inside `Self` comes first.
      'inline:component-recursive:Self',
      'inline:props-spread:Box',
      'inline:component-params:Pair',
      'inline:component-async:Later',
      'inline:component-return:Maybe',
      'inline:component-recursive:Self',
      'inline:lazy:Page',
    ]);
  });

  it('gives the reason a call site is turned down', () => {
    expect(
      reasons(`function Title(props) { return <h1>{props.label}</h1>; }
function Field(props) { return <input ref={props.ref} />; }
function Row(props) { const [on] = createSignal(false); return <li>{on()}{props.name}</li>; }
export const A = (p) => { let el; return <main>
  <Title {...p} />
  <Field ref={el} />
  <For each={p.items}>{(item) => <Row name={item.name} />}</For>
</main>; };`),
    ).toEqual(['inline:call-spread:Title', 'inline:call-ref:Field', 'inline:no-host:Row']);
  });

  it('reports a component that is only turned down for its size', () => {
    expect(
      reasons(`function Big(props) { return <section><h1 class="a very long class name">{props.a}</h1><p>{props.b}</p></section>; }
export const A = (p) => <main><Big a={p.a} b={p.b} /><Big a={p.c} b={p.d} /><Big a={p.e} b={p.f} /></main>;
export { Big };`),
    ).toEqual(['inline:size:Big', 'inline:size:Big', 'inline:size:Big']);
  });

  it('reports imported and nested components', () => {
    expect(
      reasons(`import { Ext } from './ext';
export function A() { const Inner = () => <i />; return <main><Ext /><Inner /></main>; }`),
    ).toEqual(['inline:imported:Ext (./ext)', 'inline:nested:Inner']);
  });

  it('leaves out built-ins and providers', () => {
    expect(
      reasons(`const Ctx = createContext();
export const A = (p) => <main><For each={p.items}>{(item) => <i>{item}</i>}</For><Ctx.Provider value={p.v}>{p.children}</Ctx.Provider></main>;`),
    ).toEqual(['contexts:provider-undefined:Ctx']);
  });

  it('gives the reason a provider stays', () => {
    expect(
      reasons(`const Ctx = createContext();
class Api {}
export const A = (p) => <main>
  <Ctx.Provider value={new Api()}><i>{useContext(Ctx)}</i></Ctx.Provider>
  <Ctx.Provider value={{ a: 1 }} extra><i /></Ctx.Provider>
  <Ctx.Provider value={{ a: 1 }}><i>{p.run()}</i></Ctx.Provider>
</main>;`),
    ).toEqual([
      'contexts:provider-value:Ctx',
      'contexts:open-call:Ctx',
      'contexts:provider-shape:Ctx',
    ]);
  });

  it('gives the reason a memo stays', () => {
    expect(
      reasons(`export function A(p) {
  const constant = createMemo(() => 3);
  const twice = createMemo(() => ({ a: p.a }));
  const late = createMemo(() => ({ a: p.a }));
  const block = createMemo(() => { return { a: p.a }; }, undefined, { equals: (a, b) => a === b });
  const equal = createMemo(() => p.a);
  return <p onClick={() => late()}>{constant()}{twice()}{twice()}{block()}{equal()}</p>;
}`),
    ).toEqual([
      'memos:memo-constant:constant',
      'memos:memo-reads:twice',
      'memos:memo-read-place:late',
      'memos:memo-options:block',
    ]);
  });

  it('only keeps the last round', () => {
    // `Inner` is inside `Outer` until `Outer` is inlined, and inlines in the next round.
    expect(
      reasons(`function Inner(props) { return <b>{props.a}</b>; }
function Outer(props) { return <i><Inner a={props.a} /></i>; }
export const A = () => <main><Outer a="x" /></main>;`),
    ).toEqual([]);
  });
});

describe('report summary', () => {
  const skips: Skip[] = [
    { pass: 'inline', reason: 'call-spread', name: 'Title' },
    { pass: 'inline', reason: 'call-spread', name: 'Title' },
    { pass: 'inline', reason: 'call-spread', name: 'Button' },
    { pass: 'memos', reason: 'memo-reads', name: 'style' },
  ];

  it('groups by reason, most frequent first', () => {
    expect(summarizeSkips(skips)).toEqual([
      {
        pass: 'inline',
        reason: 'call-spread',
        count: 3,
        names: [
          ['Title', 2],
          ['Button', 1],
        ],
      },
      { pass: 'memos', reason: 'memo-reads', count: 1, names: [['style', 1]] },
    ]);
  });

  it('prints one line per reason', () => {
    expect(formatReport({ environment: 'client', skips })).toBe(
      [
        'solid-optimizer: what stays as written in client',
        '  inline   call-spread    3  Title×2, Button',
        '  memos    memo-reads     1  style',
      ].join('\n'),
    );
  });
});
