import { render } from 'solid-js/web';
import { lazy, Show } from 'solid-js';

const SHOW_ADMIN = false;

const Admin = lazy(() => import('./Admin'));

function App() {
  return (
    <main>
      <h1>Home</h1>
      <Show when={SHOW_ADMIN}>
        <Admin />
      </Show>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
