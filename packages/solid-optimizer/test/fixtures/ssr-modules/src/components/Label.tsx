export function Label(props: { text: string; count: number }) {
  return (
    <span class="label">
      {props.text}: {props.count}
    </span>
  );
}
