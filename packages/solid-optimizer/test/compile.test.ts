import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { describe, expect, it } from 'vitest';
import { compile } from '../src';
import { lower, optimize } from './utils';

const APP = `import { Show } from 'solid-js';

const DEBUG = false;

function Title(props) {
  return <h1>{props.text}</h1>;
}

function Panel(props) {
  const [open, setOpen] = createSignal(props.initial);
  return (
    <section>
      <Title text={props.title} />
      <Show when={DEBUG}>
        <pre>debug</pre>
      </Show>
      <button onClick={() => setOpen(!open())}>toggle</button>
    </section>
  );
}

export function App() {
  return (
    <main>
      <Panel title="Settings" initial={false} />
    </main>
  );
}
`;

describe('compile', () => {
  it('returns the input untouched when nothing applies', () => {
    const code = 'export const view = <div>{count()}</div>;';
    expect(compile(code)).toEqual({ code, map: null });
  });

  it('runs passes until nothing changes', () => {
    const { code } = compile(APP, { sourceMap: false });
    expect(code).toBe(`import { Show } from 'solid-js';

const DEBUG = false;





export function App() {
  const [open$1, setOpen$1] = createSignal(false);
  return (
    <main>
      <section>
      <h1>{"Settings"}</h1>
      
      <button onClick={() => setOpen$1(!open$1())}>toggle</button>
    </section>
    </main>
  );
}
`);
    // Compiling the output again finds nothing left to do.
    expect(compile(code).map).toBeNull();
  });

  it('merges the whole tree into one template', () => {
    const lowered = lower(optimize(APP));
    expect(lowered.match(/_\$template\(/g)).toHaveLength(1);
    expect(lowered).toContain('<main><section><h1>Settings</h1><button>toggle');
  });

  it('produces the same tree for the server and the client', () => {
    const code = optimize(APP);
    const dom = lower(code, 'dom');
    const ssr = lower(code, 'ssr');
    expect(dom).toContain('_$template(`<main><section><h1>Settings</h1><button>toggle`)');
    expect(ssr).toContain('><section><h1>Settings</h1><button>toggle</button></section></main>');
  });

  it('respects maxPasses', () => {
    const { code } = compile(APP, { sourceMap: false, maxPasses: 1 });
    // One round inlines `Title` into `Panel`. `Panel` waits for the next round,
    // so its copies include the inlined `Title`.
    expect(code).toContain('<h1>{props.title}</h1>');
    expect(code).toContain('<Panel title="Settings" initial={false} />');
  });

  it('maps output back to the input', () => {
    const { code, map } = compile(APP, { filename: 'app.jsx' });
    expect(map).not.toBeNull();
    if (!map) {
      return;
    }
    expect(map.sources).toEqual(['app.jsx']);
    const tracer = new TraceMap(map.toString());
    const lines = code.split('\n');
    const originalLines = APP.split('\n');
    const trace = (needle: string): string => {
      const line = lines.findIndex((text) => text.includes(needle));
      const column = lines[line]?.indexOf(needle) ?? -1;
      const original = originalPositionFor(tracer, { line: line + 1, column });
      return originalLines[(original.line ?? 0) - 1]?.slice(original.column ?? 0) ?? '';
    };
    expect(trace('export function App')).toMatch(/^export function App/);
    // Inlined JSX is a copy, so it maps to the call site it replaced.
    expect(trace('<section>')).toMatch(/^<Panel/);
  });

  it('parses TypeScript by file name', () => {
    const code = `
interface Props { label: string }
function Label(props: Props) {
  return <span>{props.label}</span>;
}
export const App = (): JSX.Element => <p><Label label={'x' as string} /></p>;
`;
    expect(optimize(code, { filename: 'app.tsx' })).toContain(
      "<p><span>{'x' as string}</span></p>",
    );
  });

  it('works on a bundled chunk', () => {
    // A bundler that preserved JSX emits every module of the chunk in one scope.
    const chunk = `import { t as createSignal, n as Show } from "./solid.js";
function Icon(props) {
	return <svg class={props.class} />;
}
function Nav$1(props) {
	return <nav>{props.children}</nav>;
}
function App() {
	return <Nav$1><Icon class="logo" /><a href="/">Home</a></Nav$1>;
}
export { App as t };
`;
    expect(optimize(chunk)).toBe(`import { t as createSignal, n as Show } from "./solid.js";


function App() {
	return <nav><svg class={"logo"} /><a href="/">Home</a></nav>;
}
export { App as t };
`);
  });

  it('reports syntax errors with the file name', () => {
    expect(() => compile('const = <div>', { filename: 'broken.jsx' })).toThrow(/broken\.jsx/);
  });
});
