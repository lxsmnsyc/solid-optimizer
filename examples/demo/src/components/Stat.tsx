// Only the lazy dashboard uses it, so it inlines inside the dashboard chunk.
export function Stat(props: { label: string; value: number }) {
  return (
    <div class="stat">
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}
