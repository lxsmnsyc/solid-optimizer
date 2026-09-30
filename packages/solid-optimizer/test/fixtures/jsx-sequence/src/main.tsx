import { render } from 'solid-js/web';

let runs = 0;
function effect(): number {
  runs += 1;
  return runs;
}

// The test is always truthy, but calling `effect()` has to stay.
function App() {
  return (
    <main>
      <p>{[effect()] ? 'on' : 'off'}</p>
      <p>{(effect(), runs)}</p>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
