import { render } from '@solidjs/web';
import { lazy, Show } from 'solid-js';
import { BETA, Banner } from './Banner';

const Beta = lazy(() => import('./Beta'));

function App() {
  return (
    <main>
      <Banner />
      <Show when={BETA}>
        <Beta />
      </Show>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
