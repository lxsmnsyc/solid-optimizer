import type { JSX } from '@solidjs/web';
import { For, createSignal, onSettled } from 'solid-js';
import pkg from 'solid-optimizer/package.json';
import { Icon } from './Icon';

export const REPOSITORY = 'https://github.com/lxsmnsyc/solid-optimizer';
export const NPM = 'https://www.npmjs.com/package/solid-optimizer';
export const INSTALL = 'npm i -D solid-optimizer';
export const CHANGELOG = `${REPOSITORY}/blob/main/packages/solid-optimizer/CHANGELOG.md`;
const VERSION = pkg.version;

export type Page = 'home' | 'docs' | 'repl' | 'not-found';

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

/** Banig's header theme button: moon in light mode, sun in dark mode. */
function ThemeButton(): JSX.Element {
  // The server cannot know the theme, so the label settles once the page runs.
  const [dark, setDark] = createSignal<boolean | undefined>(undefined);

  function isDark(): boolean {
    const chosen = document.documentElement.dataset.theme;
    if (chosen) {
      return chosen === 'dark';
    }
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  onSettled(() => {
    setDark(isDark());
  });

  function toggle(): void {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // The choice still holds for this page.
    }
    setDark(next === 'dark');
  }

  const label = (): string => {
    const value = dark();
    if (value === undefined) {
      return 'Switch the theme';
    }
    return value ? 'Switch to light theme' : 'Switch to dark theme';
  };

  return (
    <button
      type="button"
      class="icon-button theme-button"
      aria-label={label()}
      title={label()}
      onClick={toggle}
    >
      <span class="theme-icon-moon">
        <Icon name="moon" />
      </span>
      <span class="theme-icon-sun">
        <Icon name="sun" />
      </span>
    </button>
  );
}

export function Header(props: { page: Page }): JSX.Element {
  return (
    <>
      <a class="skip" href="#main">
        Skip to content
      </a>
      <header class="site-header">
        <div class="site-header-inner">
          <a class="wordmark" href="/">
            <Mark />
            solid-optimizer
            <span class="wordmark-version">v{VERSION}</span>
          </a>
          <div class="site-header-slot" />
          <nav class="pills site-nav" aria-label="Site">
            <For each={LINKS}>
              {(link) => (
                <a
                  href={link.href}
                  class="pill"
                  aria-current={link.page === props.page ? 'page' : undefined}
                >
                  {link.label}
                </a>
              )}
            </For>
            <a
              class="icon-button"
              href={REPOSITORY}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="solid-optimizer on GitHub"
              title="solid-optimizer on GitHub"
            >
              <Icon name="github" />
            </a>
            <ThemeButton />
          </nav>
        </div>
      </header>
    </>
  );
}

export function Footer(): JSX.Element {
  return (
    <footer class="site-footer">
      <span>MIT © Alexis Munsayac</span>
      <nav aria-label="Footer">
        <a href={REPOSITORY} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <a href={NPM} target="_blank" rel="noopener noreferrer">
          npm
        </a>
        <a href={CHANGELOG} target="_blank" rel="noopener noreferrer">
          Changelog
        </a>
      </nav>
    </footer>
  );
}
