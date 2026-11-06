import { Errored, For, Loading, Show, createSignal } from 'solid-js';
import { ErrorBox } from '../../../../examples/tracker/src/components/ErrorBox';
import { FilterBar } from '../../../../examples/tracker/src/components/FilterBar';
import { IssueDetail } from '../../../../examples/tracker/src/components/IssueDetail';
import { IssueRow } from '../../../../examples/tracker/src/components/IssueRow';
import { Summary } from '../../../../examples/tracker/src/components/Summary';
import type { Issue } from '../../../../examples/tracker/src/data';
import { ISSUES } from '../../../../examples/tracker/src/data';

function findIssue(id: number | undefined): Issue | undefined {
  for (const issue of ISSUES) {
    if (issue.id === id) {
      return issue;
    }
  }
  return undefined;
}

// The tracker's layout with its issues read at once instead of loaded, so a
// render creates every row. No issue starts selected, since its comments
// would load after the render, and the measures would catch them halfway.
export function App() {
  const [selected, setSelected] = createSignal<number>();
  return (
    <main class="tracker">
      <header class="top">
        <h1>Tracker</h1>
        <Loading fallback={<p class="summary">Counting…</p>}>
          <Summary issues={ISSUES} />
        </Loading>
      </header>
      <FilterBar filter="all" onChange={() => undefined} />
      <ul class="issues">
        <For each={ISSUES}>
          {(issue) => (
            <IssueRow
              issue={issue}
              selected={selected() === issue.id}
              onSelect={() => {
                setSelected(issue.id);
              }}
            />
          )}
        </For>
      </ul>
      <aside class="detail">
        <Show when={findIssue(selected())} fallback={<p class="empty">Select an issue.</p>}>
          {(issue) => (
            <Errored fallback={(error, reset) => <ErrorBox error={error()} reset={reset} />}>
              <Loading fallback={<p class="loading">Loading comments…</p>}>
                <IssueDetail issue={issue()} />
              </Loading>
            </Errored>
          )}
        </Show>
      </aside>
    </main>
  );
}
