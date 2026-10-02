// The entry imports `Title`, so this module lands in the entry's chunk.
export function Title(props: { text: string }) {
  return <h1>{props.text}</h1>;
}

// Only the lazy page renders it. A copy there repeats all of it, which only
// pays off because the original goes away.
export function Panel(props: { title: string }) {
  const heading = () => props.title.toUpperCase();
  return (
    <section class="panel" title={props.title}>
      <h2 class={heading().length > 3 ? 'long' : 'short'}>{heading()}</h2>
      <p>A panel with some text that only one module renders.</p>
      <ul>
        <li class="item">{props.title} one</li>
        <li class="item">{props.title} two</li>
        <li class="item">{props.title} three</li>
      </ul>
    </section>
  );
}
