// Used by the entry chunk and the lazy settings page. It lives in the entry
// chunk, so the settings chunk keeps calling it.
export function Avatar(props: { name: string }) {
  return (
    <span class="avatar" title={props.name}>
      {props.name.slice(0, 1)}
    </span>
  );
}
