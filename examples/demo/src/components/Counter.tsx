import { createSignal } from 'solid-js';
import { Button } from './Button';

// Has statements, which move into the component that renders it.
export function Counter(props: { label: string; start: number }) {
  const [count, setCount] = createSignal(props.start);
  return (
    <p class="counter">
      {props.label}: <strong>{count()}</strong>{' '}
      <Button
        icon="plus"
        onClick={() => {
          setCount(count() + 1);
        }}
      >
        Add one
      </Button>
    </p>
  );
}
