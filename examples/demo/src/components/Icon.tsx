// A leaf component with only JSX. It inlines anywhere in its chunk.
export function Icon(props: { name: string }) {
  return <span class={`icon icon-${props.name}`} aria-hidden="true" />;
}
