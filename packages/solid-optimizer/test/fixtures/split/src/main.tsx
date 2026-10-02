import { render } from 'solid-js/web';
import { lazy, Suspense } from 'solid-js';
import { Card } from './Card';

const Page = lazy(() => import('./Page'));

function App() {
  return (
    <main>
      <Card title="Home">
        <p>eager</p>
      </Card>
      <Suspense fallback={<p>loading</p>}>
        <Page />
      </Suspense>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
