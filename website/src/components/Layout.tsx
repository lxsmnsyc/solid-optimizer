import type { JSX } from '@solidjs/web';
import { For, Show, createSignal, onSettled } from 'solid-js';
import pkg from 'solid-optimizer/package.json';
import { DocsNav } from './DocsNav';
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

/**
 * Banig's MobileDrawer: below 48rem the nav links hide and this holds them,
 * with the docs sections on docs pages. It stays mounted, so opening and
 * closing reverse from wherever they are.
 */
function MenuDrawer(props: { page: Page; slug?: string }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let drawer: HTMLElement | undefined;
  let opener: HTMLButtonElement | undefined;

  function show(): void {
    setOpen(true);
    requestAnimationFrame(() => {
      drawer?.querySelector<HTMLElement>('a, button')?.focus();
    });
  }

  function hide(): void {
    setOpen(false);
    opener?.focus();
  }

  onSettled(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && open()) {
        hide();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  });

  return (
    <>
      <button
        type="button"
        class="icon-button menu-button"
        aria-label="Open menu"
        title="Open menu"
        aria-expanded={open() ? 'true' : 'false'}
        aria-controls="menu-drawer"
        onClick={show}
        ref={(element) => {
          opener = element;
        }}
      >
        <Icon name="menu" />
      </button>
      <div
        id="menu-drawer"
        class="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        data-state={open() ? 'open' : 'closed'}
        inert={!open()}
        ref={(element) => {
          drawer = element;
        }}
      >
        <div class="drawer-head">
          <span class="wordmark drawer-wordmark">solid-optimizer</span>
          <button
            type="button"
            class="icon-button"
            aria-label="Close menu"
            title="Close menu"
            onClick={hide}
          >
            <Icon name="x" />
          </button>
        </div>
        <ul class="sidebar-list drawer-links">
          <li>
            <a href="/" aria-current={props.page === 'home' ? 'page' : undefined}>
              Home
            </a>
          </li>
          <For each={LINKS}>
            {(link) => (
              <li>
                <a
                  href={link.href}
                  aria-current={link.page === props.page && !props.slug ? 'page' : undefined}
                >
                  {link.label}
                </a>
              </li>
            )}
          </For>
        </ul>
        <Show when={props.page === 'docs'}>
          <DocsNav slug={props.slug} />
        </Show>
      </div>
      <div class="scrim" data-for="drawer" data-state={open() ? 'open' : 'closed'} onClick={hide} />
    </>
  );
}

/** The platform of the system: the client hints where there are any, else the user agent. */
function readPlatform(): string {
  // `userAgentData` is not in every browser or in the DOM types of every TypeScript version.
  const hints: unknown = Reflect.get(navigator, 'userAgentData');
  const platform: unknown =
    typeof hints === 'object' && hints !== null ? Reflect.get(hints, 'platform') : '';
  return typeof platform === 'string' && platform !== '' ? platform : navigator.userAgent;
}

export function Header(props: { page: Page; slug?: string }): JSX.Element {
  // The search key hint names the key of the system, once the page knows it.
  const [shortcut, setShortcut] = createSignal('Ctrl K');
  onSettled(() => {
    if (/mac|iphone|ipad/i.test(readPlatform())) {
      setShortcut('⌘K');
    }
  });
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
          <div class="site-header-slot">
            {/* src/search/bind.ts opens the search bar from this button, `/` and Ctrl or Cmd+K. */}
            <button
              type="button"
              class="search-trigger"
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K Meta+K /"
              aria-label="Search the docs"
            >
              <Icon name="search" />
              <span>Search docs</span>
              <kbd class="kbd">{shortcut()}</kbd>
            </button>
          </div>
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
            <MenuDrawer page={props.page} slug={props.slug} />
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
