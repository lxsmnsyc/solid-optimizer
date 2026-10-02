import { render } from 'solid-js/web';
import { lazy, Suspense } from 'solid-js';
import { Title } from './parts';

const Page = lazy(() => import('./Page'));

function App() {
  return (
    <main>
      <Title text="Hello" />
      <Suspense fallback={<p>loading</p>}>
        <Page />
      </Suspense>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
