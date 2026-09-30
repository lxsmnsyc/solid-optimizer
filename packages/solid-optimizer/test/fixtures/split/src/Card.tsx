export function Card(props: { title: string; children?: unknown }) {
  return (
    <section class="card">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}
