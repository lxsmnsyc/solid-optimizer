import { Match, Switch } from 'solid-js';
import type { Issue } from '../data';

export function Priority(props: { level: Issue['priority'] }) {
  return (
    <Switch fallback={<span class="priority low">Low</span>}>
      <Match when={props.level === 'high'}>
        <span class="priority high">High</span>
      </Match>
      <Match when={props.level === 'medium'}>
        <span class="priority medium">Medium</span>
      </Match>
    </Switch>
  );
}
