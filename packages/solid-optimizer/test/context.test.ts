/**
 * The provider pass, and the inline pass moving consumers out through a
 * provider whose reads are all visible.
 */
import { describe, expect, it } from 'vitest';
import { optimize } from './utils';

const IMPORTS =
  "import { createContext, createSignal, mergeProps, splitProps, useContext } from 'solid-js';\n";

function contexts(code: string): string {
  return optimize(IMPORTS + code);
}

describe('providers', () => {
  it('replaces a direct read and removes the provider', () => {
    expect(
      contexts(`const Theme = createContext('light');
export const App = () => <main><Theme.Provider value="dark"><span>{useContext(Theme)}</span></Theme.Provider></main>;`),
    ).toContain('<main><span>{"dark"}</span></main>');
  });

  it('moves a consumer that reads in a statement out through the provider', () => {
    const code = contexts(`const Theme = createContext();
function Label() {
  const theme = useContext(Theme);
  return <span class={theme}>label</span>;
}
export function App() {
  return <main><Theme.Provider value="dark"><Label /></Theme.Provider></main>;
}`);
    expect(code).toContain('const theme$1 = "dark";');
    expect(code).toContain('<main><span class={"dark"}>label</span></main>');
    expect(code).not.toContain('<Theme.Provider');
  });

  it('stores an object value once and shares it', () => {
    const code = contexts(`const Tabs = createContext();
function TabList(props) {
  const [active, setActive] = createSignal(0);
  return <div><Tabs.Provider value={{ active, setActive }}>{props.children}</Tabs.Provider></div>;
}
function Tab(props) {
  const tabs = useContext(Tabs);
  return <button class={tabs.active() === props.index ? 'on' : ''} onClick={() => tabs.setActive(props.index)}>{props.children}</button>;
}
export function App() {
  return <TabList><Tab index={0}>One</Tab><Tab index={1}>Two</Tab></TabList>;
}`);
    expect(code).toContain('const tabsValue$1 = { active: active$1, setActive: setActive$1 };');
    expect(code).toContain('const tabs$1 = tabsValue$1;');
    expect(code).toContain('const tabs$2 = tabsValue$1;');
    expect(code).not.toContain('<Tabs.Provider');
    expect(code).not.toContain('<Tab ');
  });

  it('moves out a consumer that spreads a view of its own props', () => {
    const code = contexts(`const Tabs = createContext();
function Tab(props) {
  const tabs = useContext(Tabs);
  const [, rest] = splitProps(mergeProps({ tone: 'plain' }, props), ['index']);
  return <button class={tabs.active() === props.index ? 'on' : ''} {...rest} />;
}
export function App() {
  const [active] = createSignal(0);
  return <nav><Tabs.Provider value={{ active }}><Tab index={0} title="first">One</Tab></Tabs.Provider></nav>;
}`);
    expect(code).not.toContain('<Tabs');
    expect(code).toMatch(
      /<button class=\{tabs\$1\.active\(\) === 0 \? 'on' : ''\} tone=\{"plain"\} title=\{"first"\}\s*>One<\/button>/,
    );
  });

  it('calls a signal getter given as the value', () => {
    const code = contexts(`const Count = createContext(() => 0);
function Display() {
  const count = useContext(Count);
  return <output>{count()}</output>;
}
export function App() {
  const [count] = createSignal(1);
  return <main><Count.Provider value={count}><section><Display /></section></Count.Provider></main>;
}`);
    expect(code).not.toContain('<Count.Provider');
    expect(code).toContain('= count;');
  });

  it('answers a read with the nearest provider', () => {
    const code = contexts(`const Theme = createContext();
const Label = () => <span>{useContext(Theme)}</span>;
export const App = () => <main><Theme.Provider value="outer"><Theme.Provider value="inner"><Label /></Theme.Provider><Label /></Theme.Provider></main>;`);
    expect(code).toContain('<main><span>{"inner"}</span><span>{"outer"}</span></main>');
  });

  it('leaves a read in an event handler, which runs with no owner', () => {
    const code = contexts(`const Theme = createContext();
export const App = () => <Theme.Provider value="dark"><button onClick={() => useContext(Theme)} /></Theme.Provider>;`);
    expect(code).toContain('<><button onClick={() => useContext(Theme)} /></>');
  });

  it('removes a provider nothing reads', () => {
    expect(
      contexts(`const Theme = createContext();
export const App = () => <main><Theme.Provider value={{ a: 1 }}><p>text</p></Theme.Provider></main>;`),
    ).toContain('<main><p>text</p></main>');
  });
});

describe('providers that stay', () => {
  const kept = (code: string): void => {
    expect(contexts(code)).toMatch(/<(Theme|Count)\.Provider value/);
  };

  it('keeps a provider with a consumer that calls an unknown function', () => {
    kept(`const Theme = createContext();
function Label() {
  const theme = useTheme();
  return <span class={theme}>label</span>;
}
export const App = () => <main><Theme.Provider value="dark"><Label /></Theme.Provider></main>;`);
  });

  it('keeps a provider around props, which run the parent code', () => {
    kept(`const Theme = createContext();
export function Box(props) {
  return <div><Theme.Provider value="dark">{props.children}</Theme.Provider></div>;
}`);
  });

  it('keeps a provider around a value built from props, whose getters run the parent code', () => {
    kept(`import { mergeDefaultProps } from 'some-library';
const Theme = createContext();
export function Box(props) {
  const merged = mergeDefaultProps({ size: 1 }, props);
  return <div><Theme.Provider value="dark">{merged.children}</Theme.Provider></div>;
}`);
    kept(`const Theme = createContext();
export function Box(props) {
  const [local] = splitProps(props, ['children']);
  return <div><Theme.Provider value="dark">{local.children}</Theme.Provider></div>;
}`);
  });

  it('keeps a provider around a function declared outside it, which it can call', () => {
    kept(`const Theme = createContext();
const label = () => useContext(Theme);
export const App = () => <main><Theme.Provider value="dark">{label}</Theme.Provider></main>;`);
    kept(`const Theme = createContext();
function label() {
  return useContext(Theme);
}
export const App = () => <main><Theme.Provider value="dark"><For each={[1]}>{label}</For></Theme.Provider></main>;`);
  });

  it('keeps a provider whose value can be undefined', () => {
    kept(`const Theme = createContext();
export const App = (props) => <Theme.Provider value={maybe}><span>{useContext(Theme)}</span></Theme.Provider>;`);
  });

  it('keeps a provider with a spread, a Dynamic, or an unknown component', () => {
    kept(`import { Dynamic } from 'solid-js/web';
const Theme = createContext();
export const A = () => <Theme.Provider value="x"><div {...rest} /></Theme.Provider>;
export const B = () => <Theme.Provider value="x"><Dynamic component={comp} /></Theme.Provider>;
export const C = () => <Theme.Provider value="x"><Imported /></Theme.Provider>;`);
  });

  it('keeps a provider whose object value is only stored at a static position', () => {
    kept(`const Theme = createContext();
function Label() {
  const theme = useContext(Theme);
  return <span class={theme.name}>label</span>;
}
export const App = (props) => (
  <ul>{props.items.map((item) => <Theme.Provider value={{ name: item }}><Label /></Theme.Provider>)}</ul>
);`);
  });

  it('keeps a provider whose value has side effects and nothing reads', () => {
    kept(`const Theme = createContext();
export const App = () => <main><Theme.Provider value={make()}><p>text</p></Theme.Provider></main>;`);
  });

  it('keeps a provider when a method of the value is not visible', () => {
    kept(`const Theme = createContext();
function Label() {
  const theme = useContext(Theme);
  return <span>{theme.read()}</span>;
}
export function App() {
  return <Theme.Provider value={{ read: () => useTheme() }}><Label /></Theme.Provider>;
}`);
  });
});
