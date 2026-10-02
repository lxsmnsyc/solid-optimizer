import { render } from '@solidjs/web';
import { lazy, Show } from 'solid-js';
import { ADMIN, THEME } from './config';

const Admin = lazy(() => import('./Admin'));

function App() {
  return (
    <main class={THEME === 'dark' ? 'dark' : 'light'}>
      <h1>Home</h1>
      <Show when={ADMIN}>
        <Admin />
      </Show>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
