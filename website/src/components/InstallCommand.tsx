import type { JSX } from '@solidjs/web';
import { For, createSignal, onSettled } from 'solid-js';
import { slideThumb } from '../lib/thumb';
import { CopyButton } from './Code';

const MANAGERS = [
  { id: 'npm', command: 'npm i -D solid-optimizer' },
  { id: 'pnpm', command: 'pnpm add -D solid-optimizer' },
  { id: 'yarn', command: 'yarn add -D solid-optimizer' },
  { id: 'bun', command: 'bun add -d solid-optimizer' },
] as const;

type Manager = (typeof MANAGERS)[number]['id'];

function isManager(value: string | null): value is Manager {
  for (const manager of MANAGERS) {
    if (manager.id === value) {
      return true;
    }
  }
  return false;
}

/** Banig's InstallCommand: package manager tabs, one command, one copy button. The pick is saved. */
export function InstallCommand(): JSX.Element {
  const [manager, setManager] = createSignal<Manager>('npm');
  let tabs: HTMLElement | undefined;

  function place(): void {
    if (tabs) {
      slideThumb(tabs, tabs.querySelector<HTMLElement>('[aria-selected="true"]') ?? undefined);
    }
  }

  onSettled(() => {
    try {
      const saved = localStorage.getItem('pm');
      if (isManager(saved)) {
        setManager(saved);
      }
    } catch {
      // Storage is blocked: npm stays.
    }
    requestAnimationFrame(place);
  });

  function pick(id: Manager): void {
    setManager(id);
    document.documentElement.dataset.pm = id;
    try {
      localStorage.setItem('pm', id);
    } catch {
      // The pick still holds on this page.
    }
    requestAnimationFrame(place);
  }

  const command = (): string => {
    for (const item of MANAGERS) {
      if (item.id === manager()) {
        return item.command;
      }
    }
    return MANAGERS[0].command;
  };

  return (
    <div class="install">
      <div
        class="pills"
        role="tablist"
        aria-label="Package manager"
        ref={(element) => {
          tabs = element;
        }}
      >
        <span class="seg-thumb" />
        <For each={MANAGERS}>
          {(item) => (
            <button
              type="button"
              role="tab"
              class="pill"
              aria-selected={manager() === item.id ? 'true' : 'false'}
              onClick={() => {
                pick(item.id);
              }}
            >
              {item.id}
            </button>
          )}
        </For>
      </div>
      <div class="install-line">
        <code>{command()}</code>
        <CopyButton text={command()} />
      </div>
    </div>
  );
}
