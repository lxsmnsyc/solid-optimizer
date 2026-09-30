import type { JSX } from '@solidjs/web';

// Used by the entry and by lazy pages, so it lives in the entry chunk. The
// entry inlines it, and the lazy chunks keep calling it.
export function Card(props: { title: string; children: JSX.Element }) {
  return (
    <section class="card">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}
