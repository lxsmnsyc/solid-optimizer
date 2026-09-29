import type { JSX } from '@solidjs/web';
import { Icon } from './Icon';

// Nests another component and splices its children into the template.
export function Button(props: { icon: string; onClick: () => void; children: JSX.Element }) {
  return (
    <button type="button" class="button" onClick={props.onClick}>
      <Icon name={props.icon} />
      {props.children}
    </button>
  );
}
