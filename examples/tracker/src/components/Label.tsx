export function Label(props: { name: string }) {
  return <span class={`label label-${props.name}`}>{props.name}</span>;
}
