import type { JSX } from 'solid-js';
import { label } from './main';

export function Box(props: JSX.HTMLAttributes<HTMLDivElement>) {
  return (
    <section>
      <h2>{label}</h2>
      <div {...props} />
    </section>
  );
}
