import { Errored, For, Loading, Show, createMemo, createSignal } from 'solid-js';
import { ErrorBox } from './components/ErrorBox';
import type { Filter } from './components/FilterBar';
import { FilterBar } from './components/FilterBar';
import { IssueDetail } from './components/IssueDetail';
import { IssueRow } from './components/IssueRow';
import { Summary } from './components/Summary';
import type { Issue } from './data';
import { fetchIssues } from './data';

function filterIssues(issues: readonly Issue[], filter: Filter): Issue[] {
  const result: Issue[] = [];
  for (const issue of issues) {
    if (filter === 'all' || issue.state === filter) {
      result.push(issue);
    }
  }
  return result;
}

function findIssue(issues: readonly Issue[], id: number | undefined): Issue | undefined {
  for (const issue of issues) {
    if (issue.id === id) {
      return issue;
    }
  }
  return undefined;
}

export function App() {
  const issues = createMemo(async () => fetchIssues());
  const [filter, setFilter] = createSignal<Filter>('open');
  const [selected, setSelected] = createSignal<number>();
  const visible = createMemo(() => filterIssues(issues(), filter()));
  const selectedIssue = createMemo(() => findIssue(issues(), selected()));
  return (
    <main class="tracker">
      <header class="top">
        <h1>Tracker</h1>
        <Loading fallback={<p class="summary">Counting…</p>}>
          <Summary issues={issues()} />
        </Loading>
      </header>
      <FilterBar
        filter={filter()}
        onChange={(next) => {
          setFilter(next);
        }}
      />
      <div class="layout">
        <Loading fallback={<p class="loading">Loading issues…</p>}>
          <ul class="issues">
            <For each={visible()}>
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
        </Loading>
        <aside class="detail">
          <Show when={selectedIssue()} fallback={<p class="empty">Select an issue.</p>}>
            {(issue) => (
              <Errored fallback={(error, reset) => <ErrorBox error={error()} reset={reset} />}>
                <Loading fallback={<p class="loading">Loading comments…</p>}>
                  <IssueDetail issue={issue()} />
                </Loading>
              </Errored>
            )}
          </Show>
        </aside>
      </div>
    </main>
  );
}
