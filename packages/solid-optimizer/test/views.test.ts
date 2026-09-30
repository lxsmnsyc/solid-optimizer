/**
 * Inlining components that read their props through `mergeProps()` and
 * `splitProps()`.
 */
import { describe, expect, it } from 'vitest';
import { optimize } from './utils';

const IMPORTS = "import { createSignal, mergeProps, splitProps } from 'solid-js';\n";

function views(code: string): string {
  return optimize(IMPORTS + code);
}

describe('mergeProps() and splitProps()', () => {
  it('resolves defaults at each call site', () => {
    const code = views(`function Button(props) {
  const merged = mergeProps({ type: 'button', size: 'md' }, props);
  return <button type={merged.type} class={merged.size}>{merged.children}</button>;
}
export const App = () => <main><Button size="lg">Save</Button><Button type="submit">Go</Button></main>;`);
    expect(code).toContain(
      '<main><button type={"button"} class={"lg"}>Save</button><button type={"submit"} class={"md"}>Go</button></main>',
    );
    expect(code).not.toContain('mergeProps(');
  });

  it('falls back to the default when a passed prop can be undefined', () => {
    const code = views(`function Button(props) {
  const merged = mergeProps({ size: 'md' }, props);
  return <button class={merged.size} />;
}
export const App = () => <Button size={size()} />;`);
    expect(code).toContain(
      '<button class={((value) => (value !== undefined ? value : "md"))(size())} />',
    );
  });

  it('reads the keys a group picked, and the rest', () => {
    const code = views(`function Input(props) {
  const [local, rest] = splitProps(props, ['label']);
  return <label>{local.label}<input title={local.value} {...rest} /></label>;
}
export function App() {
  const [value, setValue] = createSignal('');
  return <Input label="Name" value={value()} onInput={(e) => setValue(e.target.value)} />;
}`);
    expect(code).toContain(
      '<label>{"Name"}<input title={void 0} value={value()} onInput={(e) => setValue(e.target.value)} /></label>',
    );
  });

  it('gives a key to the first group that names it', () => {
    const code = views(`function Box(props) {
  const [a, b, rest] = splitProps(props, ['x'], ['x', 'y']);
  return <div data-a={a.x} data-b={b.x} data-y={b.y} {...rest} />;
}
export const App = () => <Box x="1" y="2" z="3" />;`);
    expect(code).toContain('<div data-a={"1"} data-b={void 0} data-y={"2"} z={"3"} />');
  });

  it('passes children through a spread onto an element without children', () => {
    expect(
      views(`function Box(props) {
  const [local, rest] = splitProps(props, ['tone']);
  return <div class={local.tone} {...rest} />;
}
export const App = () => <Box tone="dark"><p>hi</p></Box>;`),
    ).toMatch(/<div class=\{"dark"\}\s*><p>hi<\/p><\/div>/);
  });

  it('splits a merged view', () => {
    const code = views(`function Field(props) {
  const merged = mergeProps({ kind: 'text' }, props);
  const [local, rest] = splitProps(merged, ['label']);
  return <div>{local.label}<input {...rest} /></div>;
}
export const App = () => <Field label="A" placeholder="x" />;`);
    expect(code).toContain('<input kind={"text"} placeholder={"x"} />');
  });
});

describe('components that stay', () => {
  const stays = (code: string): void => {
    expect(views(code)).toMatch(/<(Box|Button) /);
  };

  it('keeps a component whose default is not a literal', () => {
    stays(`function Button(props) {
  const merged = mergeProps({ onClick: () => {} }, props);
  return <button onClick={merged.onClick} />;
}
export const App = () => <Button />;`);
  });

  it('keeps a component that passes a view on', () => {
    stays(`function Box(props) {
  const [local, rest] = splitProps(props, ['tone']);
  track(rest);
  return <div />;
}
export const App = () => <Box tone="dark" />;`);
  });

  it('keeps a component whose spread repeats an attribute', () => {
    stays(`function Box(props) {
  const [, rest] = splitProps(props, ['tone']);
  return <div class="box" {...rest} />;
}
export const App = () => <Box tone="dark" class="x" />;`);
  });

  it('keeps a component that splits keys it cannot see', () => {
    stays(`function Box(props) {
  const [local, rest] = splitProps(props, keys);
  return <div {...rest} />;
}
export const App = () => <Box tone="dark" />;`);
  });
});
