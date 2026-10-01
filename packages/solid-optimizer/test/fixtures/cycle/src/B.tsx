import { A } from './A';

export function B(props: { depth: number }) {
  return <div class="b">{props.depth > 0 ? <A depth={props.depth - 1} /> : 'end'}</div>;
}
