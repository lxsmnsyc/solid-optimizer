import { render } from '@solidjs/web';
import { lazy, Loading } from 'solid-js';
import { Title } from './parts';

const Page = lazy(() => import('./Page'));

function App() {
  return (
    <main>
      <Title text="Hello" />
      <Loading fallback={<p>loading</p>}>
        <Page />
      </Loading>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
