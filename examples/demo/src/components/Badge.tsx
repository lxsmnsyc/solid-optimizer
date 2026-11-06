// Only `Table` uses it, so it inlines wherever `Table`'s chunk is.
export function Badge(props: { tone: string; text: string }) {
  return <mark class={`badge badge-${props.tone}`}>{props.text}</mark>;
}
