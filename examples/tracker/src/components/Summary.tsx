import { createMemo } from 'solid-js';
import type { Issue } from '../data';

function countOpen(issues: readonly Issue[]): number {
  let count = 0;
  for (const issue of issues) {
    if (issue.state === 'open') {
      count += 1;
    }
  }
  return count;
}

export function Summary(props: { issues: readonly Issue[] }) {
  const open = createMemo(() => countOpen(props.issues));
  return (
    <p class="summary">
      <strong>{open()}</strong> open, <strong>{props.issues.length - open()}</strong> closed
    </p>
  );
}
