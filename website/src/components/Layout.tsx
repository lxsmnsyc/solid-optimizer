import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';

export const REPOSITORY = 'https://github.com/lxsmnsyc/solid-optimizer';
export const NPM = 'https://www.npmjs.com/package/solid-optimizer';
export const INSTALL = 'npm i -D solid-optimizer@next';

export type Page = 'home' | 'docs' | 'repl';

const LINKS: { page: Page; href: string; label: string }[] = [
  { page: 'docs', href: '/docs/', label: 'Docs' },
  { page: 'repl', href: '/repl/', label: 'REPL' },
];

export function Mark(): JSX.Element {
  return (
    <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="mark-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#76b3e1" />
          <stop offset="1" stop-color="#2c4f7c" />
        </linearGradient>
      </defs>
      <path d="M6 7h20l-5 5H6z" fill="#446b9e" />
      <path d="M6 14h20l-5 5H6z" fill="#4f88c6" />
      <path d="M6 21h20l-5 5H6z" fill="url(#mark-gradient)" />
    </svg>
  );
}

function GitHubIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" class="icon">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

export function Header(props: { page: Page }): JSX.Element {
  return (
    <header class="nav">
      <a class="brand" href="/">
        <Mark />
        <span>solid-optimizer</span>
      </a>
      <nav class="nav-links">
        <For each={LINKS}>
          {(link) => (
            <a
              href={link.href}
              class={{ current: link.page === props.page }}
              aria-current={link.page === props.page ? 'page' : undefined}
            >
              {link.label}
            </a>
          )}
        </For>
        <a
          class="nav-icon"
          href={REPOSITORY}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
        >
          <GitHubIcon />
        </a>
      </nav>
    </header>
  );
}

export function Footer(): JSX.Element {
  return (
    <footer class="footer">
      <a class="brand" href="/">
        <Mark />
        <span>solid-optimizer</span>
      </a>
      <span>MIT © lxsmnsyc</span>
      <span class="footer-note">
        This site is prerendered and built with{' '}
        <a
          href={`${REPOSITORY}/blob/main/website/vite.config.ts`}
          target="_blank"
          rel="noopener noreferrer"
        >
          solid-optimizer
        </a>
        .
      </span>
      <nav>
        <a href="/docs/">Docs</a>
        <a href="/repl/">REPL</a>
        <a href={REPOSITORY} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <a href={NPM} target="_blank" rel="noopener noreferrer">
          npm
        </a>
      </nav>
    </footer>
  );
}
