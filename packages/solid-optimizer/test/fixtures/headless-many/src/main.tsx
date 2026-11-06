import { createMemo, createSignal, merge, omit, untrack } from 'solid-js';
import type { JSX } from 'solid-js';
import { Dynamic, render } from '@solidjs/web';

// Like Kobalte's: renders the element its `as` prop names, with the rest.
function Polymorphic(props: Record<string, unknown> & { as: string }) {
  const others = omit(props, 'as');
  if (!untrack(() => props.as)) throw new Error('Polymorphic needs an `as` prop.');
  return <Dynamic {...others} component={props.as} />;
}

function ButtonRoot(props: { class?: string; children?: JSX.Element; onClick?: () => void }) {
  const [ref, setRef] = createSignal<Element | undefined>(undefined, { ownedWrite: true });
  const merged = merge({ type: 'button' }, props);
  const others = omit(merged, 'type');
  const tag = createMemo(() => ref()?.tagName.toLowerCase() ?? 'button');
  const native = createMemo(() => {
    const name = tag();
    if (name === undefined) return false;
    return name === 'button' || (name === 'input' && ref()?.getAttribute('type') === 'button');
  });
  const input = createMemo(() => tag() === 'input');
  const link = createMemo(() => tag() === 'a' && ref()?.getAttribute('href') != null);
  return (
    <Polymorphic
      as="button"
      ref={[setRef, undefined]}
      type={native() ? merged.type : undefined}
      role={!native() && !link() ? 'button' : undefined}
      tabindex={!native() && !link() ? 0 : undefined}
      aria-disabled={!native() && !input() ? undefined : undefined}
      {...others}
    />
  );
}

const Button = ButtonRoot;

function App() {
  const [count, setCount] = createSignal(0);
  return (
    <main>
      <Button class="a" onClick={() => setCount(count() + 1)}>
        Add
      </Button>
      <Button class="b" onClick={() => setCount(count() - 1)}>
        Remove
      </Button>
      <Button class="c" onClick={() => setCount(0)}>
        Reset
      </Button>
      <p>{count()}</p>
    </main>
  );
}

render(() => <App />, document.getElementById('app')!);
