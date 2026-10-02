import { render } from '@solidjs/web';
import { lazy, Loading } from 'solid-js';
import { Badge } from './Badge';

const Page = lazy(() => import('./Page'));

function App() {
  return (
    <main>
      <Badge tone="info" title="eager">
        eager
      </Badge>
      <Loading fallback={<p>loading</p>}>
        <Page />
      </Loading>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
