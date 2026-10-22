import { FLAG_B } from './via-b';

export const FLAG_A = true;

export function A() {
  return <p class="a">{FLAG_B ? 'b on' : 'b off'}</p>;
}
