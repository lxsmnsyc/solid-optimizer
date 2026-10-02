/**
 * Inlining only where the copies are no larger than what they replace.
 */
import { describe, expect, it } from 'vitest';
import { optimize } from './utils';

/**
 * A wrapper around another component. A copy cannot merge into a template,
 * and repeats the wrapper's own code at every call.
 */
const CARD = `
function Card(props) {
  const [local, others] = splitProps(props, ['class']);
  return <Primitive class={cn('rounded-lg border bg-card text-card-foreground shadow-sm', local.class)} {...others} />;
}
`;

describe('size-aware inlining', () => {
  it('inlines a component used once, whose declaration goes away', () => {
    const code =
      optimize(`import { splitProps } from 'solid-js';\nimport { Primitive } from 'some-library';
${CARD}
export const App = () => <main><Card class="a">one</Card></main>;`);
    expect(code).not.toContain('<Card');
    expect(code).not.toContain('function Card');
  });

  it('keeps a component with code of its own that many calls would repeat', () => {
    const code =
      optimize(`import { splitProps } from 'solid-js';\nimport { Primitive } from 'some-library';
${CARD}
export const App = () => (
  <main>
    <Card class="a">one</Card>
    <Card class="b">two</Card>
    <Card class="c">three</Card>
  </main>
);`);
    expect(code).toContain('<Card class="a">one</Card>');
    expect(code).toContain('function Card');
  });

  it('inlines a small component at every call', () => {
    const code = optimize(`
function Item(props) {
  return <li>{props.children}</li>;
}
export const App = () => <ul><Item>a</Item><Item>b</Item><Item>c</Item></ul>;`);
    expect(code).toContain('<ul><li>a</li><li>b</li><li>c</li></ul>');
  });

  it('counts what constant props fold away', () => {
    const code = optimize(`
function Button(props) {
  return (
    <button class={props.variant === 'primary' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : props.variant === 'outline' ? 'border border-input hover:bg-accent' : 'hover:bg-accent hover:text-accent-foreground'}>
      {props.children}
    </button>
  );
}
export const App = () => <p><Button variant="primary">a</Button><Button variant="primary">b</Button></p>;`);
    expect(code).not.toContain('<Button');
    expect(code).not.toContain('outline');
  });

  it('keeps a component whose code stays elsewhere unless each copy is smaller', () => {
    const app = `import { splitProps } from 'solid-js';\nimport { Primitive } from 'some-library';
${CARD}
export const App = () => <main><Card class="a">one</Card></main>;`;
    expect(optimize(app, { sharedComponents: { Card: 0 } })).toContain(
      '<Card class="a">one</Card>',
    );
  });

  it('counts the calls in its children that can only inline once it does', () => {
    // A copy of `Card` brings its own template, which is larger than the call.
    // `Counter` has statements, which need an element around its call.
    const app = `import { createSignal } from 'solid-js';
function Card(props) {
  return <section class="card"><h2>{props.title}</h2>{props.children}</section>;
}
function Counter(props) {
  const [count, setCount] = createSignal(props.start);
  return <button type="button" class="counter" onClick={() => setCount(count() + 1)}>{props.label}: {count()}</button>;
}
export const Home = () => <Card title="Home"><Counter label="Clicks" start={0} /></Card>;`;
    const code = optimize(app, { sharedComponents: { Card: 0 } });
    expect(code).not.toContain('<Card');
    expect(code).not.toContain('<Counter');
  });

  it('inlines every component it can with alwaysInline', () => {
    const code = optimize(
      `import { splitProps } from 'solid-js';\nimport { Primitive } from 'some-library';
${CARD}
export const App = () => <main><Card class="a">one</Card><Card class="b">two</Card><Card class="c">three</Card></main>;`,
      { alwaysInline: true },
    );
    expect(code).not.toContain('<Card');
  });
});
