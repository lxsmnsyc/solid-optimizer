import { describe, expect, it } from 'vitest';
import { lower, optimize, templateCount } from './utils';

function inlined(code: string): string {
  return optimize(code, { fold: false });
}

describe('component inlining', () => {
  it('merges a component into the template that uses it', () => {
    const code = `
function Title(props) {
  return <h1 class="title">{props.label}</h1>;
}
export function App() {
  return <main><Title label="Hello" /><p>body</p></main>;
}
`;
    expect(inlined(code)).toBe(`

export function App() {
  return <main><h1 class="title">{"Hello"}</h1><p>body</p></main>;
}
`);
    expect(templateCount(code)).toBe(2);
    expect(templateCount(inlined(code))).toBe(1);
    expect(lower(inlined(code))).toContain('_$template(`<main><h1 class=title>Hello</h1><p>body`)');
  });

  it('inlines arrow function components', () => {
    const code = `
const Badge = (props) => <span class="badge">{props.count}</span>;
export const App = () => <div><Badge count={count()} /></div>;
`;
    expect(inlined(code)).toBe(`

export const App = () => <div><span class="badge">{count()}</span></div>;
`);
  });

  it('substitutes a dynamic prop at every read, like a getter', () => {
    const code = `
function Pair(props) {
  return <p title={props.value}>{props.value}</p>;
}
export function App() {
  return <Pair value={store.value} />;
}
`;
    expect(inlined(code)).toContain('<p title={store.value}>{store.value}</p>');
  });

  it('adds parentheses where the read sits inside a larger expression', () => {
    const code = `
function Link(props) {
  return <a href={props.url.href} title={new props.Title()}>{props.label}</a>;
}
export function App() {
  return <Link url={a ?? b} Title={pick()} label={x || y} />;
}
`;
    expect(inlined(code)).toContain('<a href={(a ?? b).href} title={new (pick())()}>{x || y}</a>');
  });

  it('turns a missing prop into undefined and a bare one into true', () => {
    const code = `
function Check(props) {
  return <input checked={props.checked} disabled={props.disabled} />;
}
export function App() {
  return <form><Check checked /></form>;
}
`;
    expect(inlined(code)).toContain('<form><input checked={true} disabled={void 0} /></form>');
  });

  it('splices children into the component body', () => {
    const code = `
function Card(props) {
  return <section class="card">{props.children}</section>;
}
export function App() {
  return <Card><h2>Title</h2><p>Text</p></Card>;
}
`;
    expect(inlined(code)).toContain(
      'return <section class="card"><h2>Title</h2><p>Text</p></section>;',
    );
    expect(templateCount(inlined(code))).toBe(1);
  });

  it('splices a JSX prop into the component body', () => {
    const code = `
function Layout(props) {
  return <div>{props.header}<main>{props.children}</main></div>;
}
export function App() {
  return <Layout header={<h1>Site</h1>}>content</Layout>;
}
`;
    expect(inlined(code)).toContain('return <div><h1>Site</h1><main>content</main></div>;');
  });

  it('keeps text around spliced children apart', () => {
    const code = `
function Label(props) {
  return <span>Hi {props.children}!</span>;
}
export function App() {
  return <Label>
    there
  </Label>;
}
`;
    const output = inlined(code);
    expect(output).toContain('<span>Hi {}\n    there\n  {}!</span>');
    expect(lower(output)).toContain('_$template(`<span>Hi there!`)');
    expect(lower(code)).toContain('Hi <!$><!/>!');
  });

  it('removes a read of missing children', () => {
    const code = `
function Box(props) {
  return <div>{props.children}</div>;
}
export function App() {
  return <Box />;
}
`;
    expect(inlined(code)).toContain('return <div></div>;');
  });

  it('moves statements into the host component', () => {
    const code = `
function Counter(props) {
  const [count, setCount] = createSignal(props.initial);
  return <button onClick={() => setCount(count() + 1)}>{count()}</button>;
}
export function App() {
  const count = 10;
  return <div><Counter initial={count} /></div>;
}
`;
    expect(inlined(code)).toBe(`

export function App() {
  const count = 10;
  const [count$1, setCount$1] = createSignal(count);
  return <div><button onClick={() => setCount$1(count$1() + 1)}>{count$1()}</button></div>;
}
`);
  });

  it('turns an arrow function host into a block', () => {
    const code = `
const Timer = () => {
  onSettled(start);
  return <time />;
};
export const App = () => <p><Timer /></p>;
`;
    expect(inlined(code)).toBe(`

export const App = () => { onSettled(start); return <p><time /></p>; };
`);
  });

  it('only moves statements where the component is created once per host run', () => {
    const code = `
function Item(props) {
  const label = format(props.value);
  return <li>{label}</li>;
}
export function App() {
  return <ul><Show when={ready()}><Item value={1} /></Show></ul>;
}
`;
    expect(inlined(code)).toBe(code);
  });

  it('stores a static prop that is read more than once', () => {
    const code = `
function Button(props) {
  return <button onClick={props.onClick} onFocus={props.onClick} />;
}
export function App() {
  return <div><Button onClick={() => save()} /></div>;
}
`;
    expect(inlined(code)).toContain('const onClick$1 = () => save();');
    expect(inlined(code)).toContain('<button onClick={onClick$1} onFocus={onClick$1} />');
  });

  it('substitutes a static prop read once without storing it', () => {
    const code = `
function Button(props) {
  return <button onClick={props.onClick} />;
}
export const App = () => <div><Button onClick={() => save()} /></div>;
`;
    expect(inlined(code)).toContain('<div><button onClick={() => save()} /></div>');
  });

  it('renames bindings so they cannot capture the call site', () => {
    const code = `
function Greeting(props) {
  const { first, last = 'Doe' } = props.user;
  const full = { first };
  return <p>{props.prefix} {full.first} {last}</p>;
}
export function App() {
  const first = 'x';
  return <div><Greeting user={user()} prefix={first} /></div>;
}
`;
    const output = inlined(code);
    expect(output).toContain("const { first: first$1, last: last$1 = 'Doe' } = user();");
    expect(output).toContain('const full$1 = { first: first$1 };');
    expect(output).toContain('<p>{first} {full$1.first} {last$1}</p>');
  });

  it('chains through components that use other components', () => {
    const code = `
const Icon = (props) => <i class={props.name} />;
const Button = (props) => <button><Icon name={props.icon} />{props.children}</button>;
export const App = () => <nav><Button icon="home">Home</Button></nav>;
`;
    const output = inlined(code);
    expect(output).toContain('<nav><button><i class={"home"} />Home</button></nav>');
    expect(output).not.toContain('Icon');
    expect(output).not.toContain('Button');
    expect(templateCount(output)).toBe(1);
  });

  it('inlines a call nested in another call after the component it calls settles', () => {
    // `Card` is ready first, but `Counter` sits inside it and waits on `Button`.
    const code = `
const Icon = (props) => <i class={props.name} />;
const Button = (props) => <button><Icon name={props.icon} />{props.children}</button>;
function Counter(props) {
  const [count, setCount] = createSignal(props.start);
  return <p>{count()} <Button icon="plus">Add</Button></p>;
}
const Card = (props) => <section>{props.children}</section>;
export function Home() {
  return <Card><Counter start={0} /></Card>;
}
`;
    const output = inlined(code);
    expect(output).toContain('const [count$1, setCount$1] = createSignal(0);');
    expect(output).toContain(
      'return <section><p>{count$1()} <button><i class={"plus"} />Add</button></p></section>;',
    );
    expect(templateCount(output)).toBe(1);
  });

  it('inlines a TypeScript component with expression statements', () => {
    // TypeScript's AST marks every expression statement with `directive: null`.
    const code = `
import { onMount } from 'solid-js';
function Box(props: { label: string }) {
  onMount(() => log(props.label));
  return <div>{props.label}</div>;
}
export function App() {
  return <main><Box label="a" /></main>;
}
`;
    const output = optimize(code, { fold: false, filename: 'app.tsx' });
    expect(output).not.toContain('function Box');
    expect(output).toContain('<main><div>{"a"}</div></main>');
  });

  it('keeps the declaration of a component used elsewhere', () => {
    const code = `
export function Title(props) {
  return <h1>{props.text}</h1>;
}
const Other = (props) => <h2>{props.text}</h2>;
render(Other);
export const App = () => <div><Title text="a" /><Other text="b" /></div>;
`;
    const output = inlined(code);
    expect(output).toContain('export function Title(props)');
    expect(output).toContain('const Other = (props)');
    expect(output).toContain('<div><h1>{"a"}</h1><h2>{"b"}</h2></div>');
  });

  it('bails on shapes it cannot keep equivalent', () => {
    const cases = [
      // The props object escapes.
      `function A(props) { return <div {...props} />; }\nexport const App = () => <A x={1} />;`,
      `function A(props) { use(props); return <div />; }\nexport const App = () => <A x={1} />;`,
      // Destructured props.
      `function A({ x }) { return <div>{x}</div>; }\nexport const App = () => <A x={1} />;`,
      // A prop is written.
      `function A(props) { props.x = 2; return <div />; }\nexport const App = () => <A x={1} />;`,
      // The call site spreads props or passes a ref.
      `function A(props) { return <div>{props.x}</div>; }\nexport const App = () => <A {...rest} />;`,
      `function A(props) { return <div ref={props.ref} />; }\nexport const App = () => <A ref={el} />;`,
      // More than one return.
      `function A(props) { if (props.x) return <b />; return <i />; }\nexport const App = () => <A x={1} />;`,
      // The component renders itself.
      `function A(props) { return <div><A /></div>; }\nexport const App = () => <A />;`,
      // It uses \`this\`.
      `function A(props) { return <div>{this.x}</div>; }\nexport const App = () => <A />;`,
      // A name it uses is shadowed at the call site.
      `const label = "a";\nconst A = () => <b>{label}</b>;\nexport function App() { const label = "b"; return <A />; }`,
      // It reads an inherited property.
      `function A(props) { return <div>{props.toString}</div>; }\nexport const App = () => <A />;`,
    ];
    for (const code of cases) {
      expect(inlined(code)).toBe(code);
    }
  });

  it('keeps a component declared somewhere other than the top level', () => {
    const code = `
export function App() {
  const Inner = (props) => <b>{props.x}</b>;
  return <Inner x={1} />;
}
`;
    expect(inlined(code)).toBe(code);
  });
});

describe('inlining with folding', () => {
  it('folds control flow that a constant prop decides', () => {
    const code = `
function Panel(props) {
  return (
    <section>
      <Show when={props.open} fallback={<p>closed</p>}>
        <p>open</p>
      </Show>
    </section>
  );
}
export function App() {
  return <main><Panel open={false} /></main>;
}
`;
    const output = optimize(code);
    expect(output).not.toContain('Show');
    expect(output).not.toContain('open</p>');
    expect(lower(output)).toContain('_$template(`<main><section><p>closed`)');
  });
});
