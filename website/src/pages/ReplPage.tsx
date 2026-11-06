import type { JSX } from '@solidjs/web';
import { Header } from '../components/Layout';
import { Repl } from '../components/Repl';

export function ReplPage(): JSX.Element {
  return (
    <div class="repl-page">
      <Header page="repl" />
      <main class="repl-main">
        <Repl />
      </main>
    </div>
  );
}
