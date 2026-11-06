import { For } from 'solid-js';

export type Filter = 'open' | 'closed' | 'all';

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
] as const;

export function FilterBar(props: { filter: Filter; onChange: (filter: Filter) => void }) {
  return (
    <nav class="filters">
      <For each={FILTERS}>
        {(item) => (
          <button
            class={{ filter: true, active: props.filter === item.value }}
            onClick={() => {
              props.onChange(item.value);
            }}
          >
            {item.label}
          </button>
        )}
      </For>
    </nav>
  );
}
