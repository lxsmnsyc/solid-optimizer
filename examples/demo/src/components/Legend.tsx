// Only the nested lazy chart uses it.
export function Legend(props: { items: string[] }) {
  return <p class="legend">{props.items.join(' · ')}</p>;
}
