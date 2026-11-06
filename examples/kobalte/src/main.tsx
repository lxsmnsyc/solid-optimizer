import { Badge } from '@kobalte/core/badge';
import { Button } from '@kobalte/core/button';
import { Link } from '@kobalte/core/link';
import { Separator } from '@kobalte/core/separator';
import { render } from '@solidjs/web';
import { createSignal } from 'solid-js';

function Toolbar() {
  const [saved, setSaved] = createSignal(0);
  const [draft, setDraft] = createSignal(true);
  return (
    <section class="toolbar">
      <h2>Settings</h2>
      <Badge class="status">{draft() ? 'Draft' : `Saved ${String(saved())} times`}</Badge>
      <Separator />
      <Button
        class="primary"
        onClick={() => {
          setSaved(saved() + 1);
          setDraft(false);
        }}
      >
        Save
      </Button>
      <Button
        class="secondary"
        onClick={() => {
          setDraft(true);
        }}
      >
        Edit
      </Button>
      <Button class="danger" disabled={draft()}>
        Delete
      </Button>
      <Separator orientation="vertical" />
      <nav>
        <Link href="/docs">Docs</Link>
        <Link href="/changelog">Changelog</Link>
      </nav>
    </section>
  );
}

function App() {
  return (
    <main>
      <h1>Kobalte</h1>
      <Toolbar />
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
