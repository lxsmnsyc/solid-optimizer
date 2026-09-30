import { createContext, createSignal, Show, useContext } from 'solid-js';

const DEBUG = false;

function Title(props: { label: string }) {
  return <h1 class="title">{props.label}</h1>;
}

function Counter(props: { initial: number; label: string }) {
  const [count, setCount] = createSignal(props.initial);
  return (
    <button type="button" onClick={() => setCount(count() + 1)}>
      {props.label}: {count()}
    </button>
  );
}

const Theme = createContext<string>();

function Themed() {
  const theme = useContext(Theme);
  return <p class={theme}>themed</p>;
}

export function App() {
  return (
    <main>
      <Title label="Hello" />
      <Show when={DEBUG}>
        <pre>debug</pre>
      </Show>
      <Counter initial={1} label="Clicks" />
      <Theme value="dark">
        <Themed />
      </Theme>
    </main>
  );
}
