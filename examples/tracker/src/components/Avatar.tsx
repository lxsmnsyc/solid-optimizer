import type { User } from '../data';

export function Avatar(props: { user: User }) {
  return (
    <span class="avatar" title={props.user.name}>
      {props.user.initials}
    </span>
  );
}
