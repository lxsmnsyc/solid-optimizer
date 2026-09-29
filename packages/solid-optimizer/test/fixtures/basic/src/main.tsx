import { render } from '@solidjs/web';
import { Show } from 'solid-js';
import { Counter } from './Counter';
import { Title } from './Title';

const DEBUG = false;

function App() {
  return (
    <main>
      <Title label="Hello" />
      <Show when={DEBUG}>
        <pre>debug</pre>
      </Show>
      <Counter initial={1} label="Clicks" />
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
