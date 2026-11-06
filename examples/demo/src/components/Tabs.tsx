import type { JSX } from '@solidjs/web';
import { createContext, createSignal, merge, omit, useContext } from 'solid-js';

interface TabsState {
  active: () => number;
  select: (index: number) => unknown;
}

// A compound component: the tabs share their state through a context. Every
// reader under the provider inlines, so the provider is removed too.
const TabsContext = createContext<TabsState>();

export function Tabs(props: { children: JSX.Element }) {
  const [active, setActive] = createSignal(0);
  return (
    <div class="tabs" role="tablist">
      <TabsContext value={{ active, select: setActive }}>{props.children}</TabsContext>
    </div>
  );
}

// `merge` gives the tone a default, and `omit` passes the other props on.
export function Tab(
  props: {
    index: number;
    tone?: string;
    children: JSX.Element;
  } & JSX.HTMLAttributes<HTMLButtonElement>,
) {
  const tabs = useContext(TabsContext);
  const merged = merge({ tone: 'plain' }, props);
  const rest = omit(merged, 'index', 'tone');
  return (
    <button
      type="button"
      role="tab"
      class={merged.tone}
      aria-selected={tabs.active() === props.index ? 'true' : 'false'}
      onClick={() => {
        tabs.select(props.index);
      }}
      {...rest}
    />
  );
}
