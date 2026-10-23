import { createSignal } from 'solid-js';
import { render } from '@solidjs/web';
import { Box } from './Box';

export const label = 'box';

function App() {
  const [tone, setTone] = createSignal('dark');
  return (
    <main>
      <Box class={tone()} onClick={() => setTone('light')} />
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
