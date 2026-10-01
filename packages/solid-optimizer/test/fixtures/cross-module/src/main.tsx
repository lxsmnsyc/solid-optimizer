import { render } from 'solid-js/web';
import { lazy, Suspense } from 'solid-js';
import { Badge } from './Badge';

const Page = lazy(() => import('./Page'));

function App() {
  return (
    <main>
      <Badge tone="info" title="eager">
        eager
      </Badge>
      <Suspense fallback={<p>loading</p>}>
        <Page />
      </Suspense>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
