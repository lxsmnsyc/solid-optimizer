import { Odd } from './Odd';

// Even and Odd import each other, so neither copies the other.
export function Even(props: { depth: number }) {
  return <i>{props.depth > 0 ? <Odd depth={props.depth - 1} /> : 'even'}</i>;
}
