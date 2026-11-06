import { render } from '@solidjs/web';
import { lazy, Loading } from 'solid-js';
import { Card } from './Card';

const Page = lazy(() => import('./Page'));

function App() {
  return (
    <main>
      <Card title="Home">
        <p>eager</p>
      </Card>
      <Loading fallback={<p>loading</p>}>
        <Page />
      </Loading>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
