import { createSignal, merge, omit, untrack } from 'solid-js';
import type { JSX } from 'solid-js';
import { Polymorphic } from './Polymorphic';
import { name } from './main';

function LinkRoot(props: { href: string; ref?: unknown; children?: JSX.Element }) {
  const [ref, setRef] = createSignal<Element | undefined>(undefined, { ownedWrite: true });
  const merged = merge({ title: name }, props);
  const others = omit(merged, 'ref');
  return (
    <Polymorphic
      as="a"
      ref={[setRef, untrack(() => merged.ref)]}
      data-ready={ref() ? '' : undefined}
      {...others}
    />
  );
}

export const Link = LinkRoot;
