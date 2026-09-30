/**
 * The provider pass, and the inline pass moving consumers out through a
 * provider whose reads are all visible.
 */
import { describe, expect, it } from 'vitest';
import { optimize } from './utils';

const IMPORTS =
  "import { createContext, createSignal, merge, omit, useContext } from 'solid-js';\n";

function contexts(code: string): string {
  return optimize(IMPORTS + code);
}

describe('providers', () => {
  it('replaces a direct read and removes the provider', () => {
    expect(
      contexts(`const Theme = createContext('light');
export const App = () => <main><Theme value="dark"><span>{useContext(Theme)}</span></Theme></main>;`),
    ).toContain('<main><span>{"dark"}</span></main>');
  });

  it('moves a consumer that reads in a statement out through the provider', () => {
    const code = contexts(`const Theme = createContext();
function Label() {
  const theme = useContext(Theme);
  return <span class={theme}>label</span>;
}
export function App() {
  return <main><Theme value="dark"><Label /></Theme></main>;
}`);
    expect(code).toContain('const theme$1 = "dark";');
    expect(code).toContain('<main><span class={"dark"}>label</span></main>');
    expect(code).not.toContain('<Theme');
  });

  it('stores an object value once and shares it', () => {
    const code = contexts(`const Tabs = createContext();
function TabList(props) {
  const [active, setActive] = createSignal(0);
  return <div><Tabs value={{ active, setActive }}>{props.children}</Tabs></div>;
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
    expect(code).not.toContain('<Tabs');
    expect(code).not.toContain('<Tab ');
  });

  it('moves out a consumer that spreads a view of its own props', () => {
    const code = contexts(`const Tabs = createContext();
function Tab(props) {
  const tabs = useContext(Tabs);
  const rest = omit(merge({ tone: 'plain' }, props), 'index');
  return <button class={tabs.active() === props.index ? 'on' : ''} {...rest} />;
}
export function App() {
  const [active] = createSignal(0);
  return <nav><Tabs value={{ active }}><Tab index={0} title="first">One</Tab></Tabs></nav>;
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
  return <main><Count value={count}><section><Display /></section></Count></main>;
}`);
    expect(code).not.toContain('<Count');
    expect(code).toContain('= count;');
  });

  it('answers a read with the nearest provider', () => {
    const code = contexts(`const Theme = createContext();
const Label = () => <span>{useContext(Theme)}</span>;
export const App = () => <main><Theme value="outer"><Theme value="inner"><Label /></Theme><Label /></Theme></main>;`);
    expect(code).toContain('<main><span>{"inner"}</span><span>{"outer"}</span></main>');
  });

  it('leaves a read in an event handler, which runs with no owner', () => {
    const code = contexts(`const Theme = createContext();
export const App = () => <Theme value="dark"><button onClick={() => useContext(Theme)} /></Theme>;`);
    expect(code).toContain('<><button onClick={() => useContext(Theme)} /></>');
  });

  it('removes a provider nothing reads', () => {
    expect(
      contexts(`const Theme = createContext();
export const App = () => <main><Theme value={{ a: 1 }}><p>text</p></Theme></main>;`),
    ).toContain('<main><p>text</p></main>');
  });
});

describe('providers that stay', () => {
  const kept = (code: string): void => {
    expect(contexts(code)).toMatch(/<(Theme|Count) value/);
  };

  it('keeps a provider with a consumer that calls an unknown function', () => {
    kept(`const Theme = createContext();
function Label() {
  const theme = useTheme();
  return <span class={theme}>label</span>;
}
export const App = () => <main><Theme value="dark"><Label /></Theme></main>;`);
  });

  it('keeps a provider around props, which run the parent code', () => {
    kept(`const Theme = createContext();
export function Box(props) {
  return <div><Theme value="dark">{props.children}</Theme></div>;
}`);
  });

  it('keeps a provider whose value can be undefined', () => {
    kept(`const Theme = createContext();
export const App = (props) => <Theme value={maybe}><span>{useContext(Theme)}</span></Theme>;`);
  });

  it('keeps a provider with a spread, a Dynamic, or an unknown component', () => {
    kept(`import { Dynamic } from '@solidjs/web';
const Theme = createContext();
export const A = () => <Theme value="x"><div {...rest} /></Theme>;
export const B = () => <Theme value="x"><Dynamic component={comp} /></Theme>;
export const C = () => <Theme value="x"><Imported /></Theme>;`);
  });

  it('keeps a provider whose object value is only stored at a static position', () => {
    kept(`const Theme = createContext();
function Label() {
  const theme = useContext(Theme);
  return <span class={theme.name}>label</span>;
}
export const App = (props) => (
  <ul>{props.items.map((item) => <Theme value={{ name: item }}><Label /></Theme>)}</ul>
);`);
  });

  it('keeps a provider whose value has side effects and nothing reads', () => {
    kept(`const Theme = createContext();
export const App = () => <main><Theme value={make()}><p>text</p></Theme></main>;`);
  });

  it('keeps a provider when a method of the value is not visible', () => {
    kept(`const Theme = createContext();
function Label() {
  const theme = useContext(Theme);
  return <span>{theme.read()}</span>;
}
export function App() {
  return <Theme value={{ read: () => useTheme() }}><Label /></Theme>;
}`);
  });
});
