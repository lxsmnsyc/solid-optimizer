import { createSignal } from 'solid-js';

export function Counter(props: { initial: number; label: string }) {
  const [count, setCount] = createSignal(props.initial);
  return (
    <button type="button" onClick={() => setCount(count() + 1)}>
      {props.label}: {count()}
    </button>
  );
}
