import { omit, untrack } from 'solid-js';
import { Dynamic } from '@solidjs/web';
import { name } from './main';

// Like Kobalte's: renders the element its `as` prop names, with the rest.
export function Polymorphic(props: Record<string, unknown> & { as: string }) {
  const others = omit(props, 'as');
  if (!untrack(() => props.as)) throw new Error(`${name} needs an \`as\` prop.`);
  return <Dynamic {...others} component={props.as} />;
}
