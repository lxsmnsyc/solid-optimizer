import { render } from '@solidjs/web';
import { Loading, Show, createSignal, lazy } from 'solid-js';
import { Banner } from './components/Banner';
import { Home } from './pages/Home';

const About = lazy(async () => import('./pages/About'));

function App() {
  const [showAbout, setShowAbout] = createSignal(false);
  return (
    <main>
      <h1>solid-optimizer demo</h1>
      <Banner />
      <Home />
      <button
        type="button"
        onClick={() => {
          setShowAbout(!showAbout());
        }}
      >
        Toggle about
      </button>
      <Show when={showAbout()}>
        <Loading fallback={<p>Loading…</p>}>
          <About />
        </Loading>
      </Show>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
