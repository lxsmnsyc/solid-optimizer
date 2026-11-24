import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';
import { SECTIONS } from '../lib/docs';

/** The docs sections as Banig's SidebarNav, with the current page marked. */
export function DocsNav(props: { slug?: string }): JSX.Element {
  return (
    <nav aria-label="Docs">
      <For each={SECTIONS}>
        {(section) => (
          <div class="sidebar-group">
            <p class="sidebar-label">{section.title}</p>
            <ul class="sidebar-list">
              <For each={section.pages}>
                {(page) => (
                  <li>
                    <a
                      href={page.href}
                      aria-current={page.slug === props.slug ? 'page' : undefined}
                    >
                      {page.title}
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
    </nav>
  );
}
