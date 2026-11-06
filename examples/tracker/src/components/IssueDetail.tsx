import { For, Match, Show, Switch, createMemo, createSignal } from 'solid-js';
import type { Issue } from '../data';
import { fetchComments } from '../data';
import { Avatar } from './Avatar';

export function IssueDetail(props: { issue: Issue }) {
  const comments = createMemo(async () => fetchComments(props.issue));
  const [tab, setTab] = createSignal<'comments' | 'details'>('comments');
  return (
    <section class="issue-detail">
      <h2>{props.issue.title}</h2>
      <nav class="tabs">
        <button
          class={{ tab: true, active: tab() === 'comments' }}
          onClick={() => {
            setTab('comments');
          }}
        >
          Comments
        </button>
        <button
          class={{ tab: true, active: tab() === 'details' }}
          onClick={() => {
            setTab('details');
          }}
        >
          Details
        </button>
      </nav>
      <Switch>
        <Match when={tab() === 'comments'}>
          <ul class="comments">
            <For each={comments()} fallback={<li class="empty">No comments yet.</li>}>
              {(comment) => (
                <li class="comment">
                  <Avatar user={comment.author} /> <p>{comment.body}</p>
                </li>
              )}
            </For>
          </ul>
        </Match>
        <Match when={tab() === 'details'}>
          <dl class="details">
            <dt>State</dt>
            <dd>{props.issue.state}</dd>
            <dt>Opened</dt>
            <dd>{props.issue.opened}</dd>
            <Show when={props.issue.assignee}>
              {(user) => (
                <>
                  <dt>Assignee</dt>
                  <dd>
                    <Avatar user={user()} /> {user().name}
                  </dd>
                </>
              )}
            </Show>
          </dl>
        </Match>
      </Switch>
    </section>
  );
}
