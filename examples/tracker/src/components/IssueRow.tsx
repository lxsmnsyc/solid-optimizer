import { For, Show, createSignal } from 'solid-js';
import type { Issue } from '../data';
import { Avatar } from './Avatar';
import { Label } from './Label';
import { Priority } from './Priority';

export function IssueRow(props: { issue: Issue; selected: boolean; onSelect: () => void }) {
  const [starred, setStarred] = createSignal(false);
  return (
    <li
      class={{ issue: true, selected: props.selected, closed: props.issue.state === 'closed' }}
      onClick={props.onSelect}
    >
      <button
        class={{ star: true, on: starred() }}
        onClick={(event) => {
          event.stopPropagation();
          setStarred(!starred());
        }}
      >
        {starred() ? '★' : '☆'}
      </button>
      <span class="id">#{props.issue.id}</span>
      <span class="title">{props.issue.title}</span>
      <For each={props.issue.labels}>{(label) => <Label name={label} />}</For>
      <Priority level={props.issue.priority} />
      <Show when={props.issue.assignee} fallback={<span class="avatar none">?</span>}>
        {(user) => <Avatar user={user()} />}
      </Show>
      <Show when={props.issue.comments > 0}>
        <span class="comments">{props.issue.comments}</span>
      </Show>
    </li>
  );
}
