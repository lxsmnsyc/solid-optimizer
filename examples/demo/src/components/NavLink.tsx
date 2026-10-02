import type { JSX } from '@solidjs/web';

// Only the entry uses it, so it inlines into the navigation.
export function NavLink(props: { active: boolean; onSelect: () => void; children: JSX.Element }) {
  return (
    <button
      type="button"
      class="nav-link"
      aria-current={props.active ? 'page' : undefined}
      onClick={props.onSelect}
    >
      {props.children}
    </button>
  );
}
