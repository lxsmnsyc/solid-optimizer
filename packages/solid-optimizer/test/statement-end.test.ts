import { describe, expect, it } from 'vitest';
import { compile } from '../src';

function optimized(code: string): string {
  return compile(code, { filename: 'app.tsx', sourceMap: false }).code;
}

function handler(body: string, value: string): string {
  return `
function Item(props) {
  return <button onClick={() => {
    open()
    ${body}
  }}>x</button>
}
export function App(p) {
  return <div><Item value={${value}} /></div>
}
`;
}

describe('statements without a semicolon', () => {
  it.each([
    ['a call of a prop', 'props.value()', 'p.close', '(p.close)()'],
    ['a member of a prop', 'props.value.go()', 'p.close', '(p.close).go()'],
    ['an optional call of a prop', 'props.value?.()', 'p.close', '(p.close)?.()'],
    ['a conditional prop', 'props.value()', 'p.a ? p.b : p.c', '(p.a ? p.b : p.c)()'],
    ['a template literal prop', 'props.value.trim()', `\`a\${p.x}\``, `\`a\${p.x}\`.trim()`],
  ])('keeps %s apart from the statement before it', (_, body, value, statement) => {
    expect(optimized(handler(body, value))).toContain(`open();\n    ${statement}`);
  });

  it('keeps an inlined arrow apart from the statement before it', () => {
    const output = optimized(`
export function App(p) {
  const pick = () => p.a ? f : g
  open()
  pick().x()
  return <b />
}
`);
    expect(output).toContain('open();\n  (p.a ? f : g).x()');
  });

  it('keeps a folded constant apart from the statement before it', () => {
    const output = optimized(`
export function App() {
  const size = 1
  open()
  size.toFixed()
  return <b />
}
`);
    expect(output).toContain('open();\n  (1).toFixed()');
  });

  it('ends a statement before its comment and keeps its else', () => {
    const output = optimized(`
export function App(p) {
  const pick = () => p.a ? f : g
  if (p.b) open() // first
  else close()
  pick().x()
  return <b />
}
`);
    expect(output).toContain('if (p.b) open(); // first\n  else close();\n  (p.a ? f : g).x()');
  });

  it('leaves the loop head of a for statement alone', () => {
    const output = optimized(`
export function App(p) {
  const pick = () => p.a ? f : g
  for (let i = 0; i < 1; i++) open()
  for (const item of p.items) close(item)
  pick().x()
  return <b />
}
`);
    expect(output).toContain('for (let i = 0; i < 1; i++) open();');
    expect(output).toContain('for (const item of p.items) close(item);');
  });

  it('adds nothing to the last statement of a block', () => {
    const output = optimized(handler('props.value()', 'p.close'));
    expect(output).toContain('(p.close)()\n  }}');
  });

  it('moves a type alias with no semicolon into an arrow function host', () => {
    const output = optimized(`
const Timer = () => {
  type Id = number
  return <time />
}
export const App = () => <p><Timer /></p>
`);
    expect(output).toContain('type Id = number; return <p><time /></p>; }');
  });

  it('ends a line comment at a carriage return', () => {
    const code = [
      'const Timer = () => {',
      '  open() // first',
      '  return <time />',
      '}',
      'export const App = () => <p><Timer /></p>',
    ].join('\r');
    expect(optimized(code)).toContain('{ open(); return <p><time /></p>; }');
  });

  it('returns code that has nothing to optimize as it was', () => {
    const code = `
const size = read()
export const App = (p) => {
  open()
  return p.children
}
`;
    expect(compile(code, { filename: 'app.tsx' })).toEqual({ code, map: null });
  });
});
