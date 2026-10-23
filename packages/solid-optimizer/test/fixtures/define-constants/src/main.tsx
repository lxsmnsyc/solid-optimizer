import { render } from '@solidjs/web';
import { lazy, Show } from 'solid-js';

declare const __DEBUG__: boolean;

const Debug = lazy(() => import('./Debug'));

function App() {
  return (
    <main>
      <h1>{import.meta.env.MODE}</h1>
      <Show when={__DEBUG__}>
        <Debug />
      </Show>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
