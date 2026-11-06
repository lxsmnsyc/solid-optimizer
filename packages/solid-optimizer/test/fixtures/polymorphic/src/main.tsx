import { render } from '@solidjs/web';
import { Link } from './Link';

export const name = 'link';

function App() {
  return (
    <main>
      <Link href="/docs">Docs</Link>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
