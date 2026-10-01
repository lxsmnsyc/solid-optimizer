import { createSignal } from 'solid-js';
import { Label } from './Label';

// Imports another component, which the importer copies in a second round.
export function Counter(props: { initial: number }) {
  const [count, setCount] = createSignal(props.initial);
  return (
    <button type="button" onClick={() => setCount(count() + 1)}>
      <Label text="Clicks" count={count()} />
    </button>
  );
}
