/**
 * Inlining components that read their props through `merge()` and `omit()`.
 */
import { describe, expect, it } from 'vitest';
import { optimize } from './utils';

const IMPORTS = "import { createSignal, merge, omit } from 'solid-js';\n";

function views(code: string): string {
  return optimize(IMPORTS + code);
}

describe('merge() and omit()', () => {
  it('resolves defaults at each call site', () => {
    const code = views(`function Button(props) {
  const merged = merge({ type: 'button', size: 'md' }, props);
  return <button type={merged.type} class={merged.size}>{merged.children}</button>;
}
export const App = () => <main><Button size="lg">Save</Button><Button type="submit">Go</Button></main>;`);
    expect(code).toContain(
      '<main><button type={"button"} class={"lg"}>Save</button><button type={"submit"} class={"md"}>Go</button></main>',
    );
    expect(code).not.toContain('merge(');
  });

  it('lets a passed undefined win over a default, like merge() does', () => {
    const code = views(`function Button(props) {
  const merged = merge({ size: 'md' }, props);
  return <button class={merged.size} />;
}
export const App = () => <Button size={undefined} />;`);
    expect(code).toContain('<button class={undefined} />');
  });

  it('reads a key no source has as undefined', () => {
    expect(
      views(`function Box(props) {
  const rest = omit(props, 'tone');
  return <div title={rest.tone} />;
}
export const App = () => <Box tone="dark" />;`),
    ).toContain('<div title={void 0} />');
  });

  it('spreads the keys a view holds onto an element', () => {
    const code = views(`function Input(props) {
  const rest = omit(props, 'label');
  return <label>{props.label}<input {...rest} /></label>;
}
export function App() {
  const [value, setValue] = createSignal('');
  return <Input label="Name" value={value()} onInput={(e) => setValue(e.target.value)} />;
}`);
    expect(code).toContain(
      '<label>{"Name"}<input value={value()} onInput={(e) => setValue(e.target.value)} /></label>',
    );
  });

  it('orders keys where the last source that carries them puts them', () => {
    const code = views(`function Field(props) {
  const merged = merge({ kind: 'text', placeholder: 'none' }, props);
  const rest = omit(merged, 'label');
  return <div>{merged.label}<input {...rest} /></div>;
}
export const App = () => <Field label="A" placeholder="x" />;`);
    expect(code).toContain('<input kind={"text"} placeholder={"x"} />');
  });

  it('passes children through a spread onto an element without children', () => {
    expect(
      views(`function Box(props) {
  const rest = omit(props, 'tone');
  return <div class={props.tone} {...rest} />;
}
export const App = () => <Box tone="dark"><p>hi</p></Box>;`),
    ).toMatch(/<div class=\{"dark"\}\s*><p>hi<\/p><\/div>/);
  });

  it('evaluates a static value once when a spread and a read share it', () => {
    const code = views(`function Box(props) {
  const rest = omit(props, 'x');
  return <div data-a={props.handler} {...rest} />;
}
export const App = () => <Box handler={{ a: 1 }} />;`);
    // An object literal is passed as a value, made once for the props object.
    expect(code).toContain('const handler$1 = { a: 1 };');
    expect(code).toContain('data-a={handler$1} handler={handler$1}');
  });
});

describe('components that stay', () => {
  const stays = (code: string): void => {
    expect(views(code)).toMatch(/<(Box|Button) /);
  };

  it('keeps a component whose default is not a literal', () => {
    stays(`function Button(props) {
  const merged = merge({ onClick: () => {} }, props);
  return <button onClick={merged.onClick} />;
}
export const App = () => <Button />;`);
  });

  it('keeps a component that passes a view on', () => {
    stays(`function Box(props) {
  const rest = omit(props, 'tone');
  track(rest);
  return <div />;
}
export const App = () => <Box tone="dark" />;`);
  });

  it('keeps a component whose spread repeats an attribute', () => {
    stays(`function Box(props) {
  const rest = omit(props, 'tone');
  return <div class="box" {...rest} />;
}
export const App = () => <Box tone="dark" class="x" />;`);
  });

  it('keeps a component whose spread passes children to an element with some', () => {
    stays(`function Box(props) {
  const rest = omit(props, 'tone');
  return <div {...rest}><span /></div>;
}
export const App = () => <Box tone="dark"><p>hi</p></Box>;`);
  });

  it('keeps a component that omits a key it cannot see', () => {
    stays(`function Box(props) {
  const rest = omit(props, key);
  return <div {...rest} />;
}
export const App = () => <Box tone="dark" />;`);
  });
});
