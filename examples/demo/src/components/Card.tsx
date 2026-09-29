import type { JSX } from '@solidjs/web';

// Used by the home page and the lazy page. The lazy page is another chunk, so
// only the home page inlines it.
export function Card(props: { title: string; children: JSX.Element }) {
  return (
    <section class="card">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}
