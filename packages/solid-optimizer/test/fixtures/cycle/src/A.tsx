import { B } from './B';

export function A(props: { depth: number }) {
  return <div class="a">{props.depth > 0 ? <B depth={props.depth - 1} /> : 'end'}</div>;
}
