import { Even } from './Even';

export function Odd(props: { depth: number }) {
  return <b>{props.depth > 0 ? <Even depth={props.depth - 1} /> : 'odd'}</b>;
}
