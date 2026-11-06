import { createSignal } from 'solid-js';
// @ts-expect-error The fixture package has no types.
import { Button } from 'headless-ui';

export function App() {
  const [count, setCount] = createSignal(0);
  return (
    <main>
      <h1>Clicks</h1>
      <Button class="add" onClick={() => setCount(count() + 2)}>
        Add {count()}
      </Button>
      <Button class="reset" onClick={() => setCount(0)}>
        Reset
      </Button>
    </main>
  );
}
