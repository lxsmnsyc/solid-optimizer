import { render } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';

const SHOW_ADMIN = false;

const [mode, setMode] = createSignal('admin mode');

function App() {
  return (
    <main>
      <h1>Home</h1>
      <Show when={SHOW_ADMIN}>
        <button onClick={() => setMode('off')}>{mode()}</button>
      </Show>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
