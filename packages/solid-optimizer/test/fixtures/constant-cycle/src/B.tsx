import { FLAG_A } from './via-a';

export const FLAG_B = false;

export function B() {
  return <p class="b">{FLAG_A ? 'a on' : 'a off'}</p>;
}
