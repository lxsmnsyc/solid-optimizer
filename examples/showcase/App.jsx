import { createSignal, Show } from 'solid-js';

const DEBUG = false;

function Icon(props) {
  return <span class={`icon icon-${props.name}`} />;
}

function Button(props) {
  return (
    <button type="button" onClick={props.onClick}>
      <Icon name={props.icon} />
      {props.children}
    </button>
  );
}

function Counter(props) {
  const [count, setCount] = createSignal(props.start);
  return (
    <p class="counter">
      {props.label}: {count()}{' '}
      <Button icon="plus" onClick={() => setCount(count() + 1)}>
        Add
      </Button>
    </p>
  );
}

export function App() {
  return (
    <main>
      <h1>Hello</h1>
      <Show when={DEBUG}>
        <pre>debug panel</pre>
      </Show>
      <Counter label="Clicks" start={0} />
    </main>
  );
}
