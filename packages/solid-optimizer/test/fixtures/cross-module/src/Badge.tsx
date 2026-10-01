import { splitProps } from 'solid-js';

const PREFIX = 'badge-';

// Spreads the rest of its props, so it needs the runtime's `spread` as written.
export function Badge(props: { tone: string; title?: string; children?: unknown }) {
  const [local, rest] = splitProps(props, ['tone']);
  return <span class={PREFIX + local.tone} {...rest} />;
}
