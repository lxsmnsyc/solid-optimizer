import type { JSX } from '@solidjs/web';
import { For, Show, createSignal, onSettled } from 'solid-js';
import { DocsNav } from '../components/DocsNav';
import { Icon } from '../components/Icon';
import { Footer, Header, REPOSITORY } from '../components/Layout';
import type { DocLink, RenderedDoc } from '../lib/docs';
import { findSectionTitle, findSiblings } from '../lib/docs';

/** The page's sections, with the one in view marked. */
function TableOfContents(props: { doc: RenderedDoc }): JSX.Element {
  const [current, setCurrent] = createSignal<string>();
  const headings = (): RenderedDoc['headings'] =>
    props.doc.headings.filter((heading) => heading.depth <= 3);

  onSettled(() => {
    const elements: HTMLElement[] = [];
    for (const heading of headings()) {
      const element = document.getElementById(heading.id);
      if (element) {
        elements.push(element);
      }
    }
    // The current section is the topmost heading in the upper third of the screen.
    const observer = new IntersectionObserver(
      (entries) => {
        let top: IntersectionObserverEntry | undefined;
        for (const entry of entries) {
          if (
            entry.isIntersecting &&
            (!top || entry.boundingClientRect.top < top.boundingClientRect.top)
          ) {
            top = entry;
          }
        }
        if (top) {
          setCurrent(top.target.id);
        }
      },
      { rootMargin: '-80px 0px -65% 0px' },
    );
    for (const element of elements) {
      observer.observe(element);
    }
    return () => {
      observer.disconnect();
    };
  });

  return (
    <Show when={headings().length > 0}>
      <aside class="docs-toc" aria-label="On this page">
        <p class="toc-label">On this page</p>
        <ul class="toc-list">
          <For each={headings()}>
            {(heading) => (
              <li class={heading.depth === 3 ? 'toc-sub' : undefined}>
                <a
                  href={`#${heading.id}`}
                  aria-current={current() === heading.id ? 'true' : undefined}
                >
                  {heading.text}
                </a>
              </li>
            )}
          </For>
        </ul>
      </aside>
    </Show>
  );
}

function PagerLink(props: { page: DocLink; rel: 'prev' | 'next' }): JSX.Element {
  return (
    <a href={props.page.href} rel={props.rel}>
      <span class="pager-dir">{props.rel === 'prev' ? 'Previous' : 'Next'}</span>
      {props.page.title}
    </a>
  );
}

/** The `#anchors` of the one-page docs, and where each moved. */
const MOVED: Record<string, string> = {
  introduction: '/docs/concepts/how-it-works/',
  setup: '/docs/guides/vite-plugin/',
  hydration: '/docs/concepts/hydration/',
  modes: '/docs/concepts/modes/',
  'cross-module': '/docs/concepts/cross-module/',
  'vite-options': '/docs/reference/vite-options/',
  report: '/docs/guides/report/',
  limits: '/docs/reference/vite-options/#limits',
  compile: '/docs/reference/compile/',
  'compile-options': '/docs/reference/compile/',
  'read-module-constants': '/docs/reference/compile/#read-module-constants',
  inline: '/docs/concepts/component-inlining/',
  'only-where-smaller': '/docs/concepts/component-inlining/#only-where-smaller',
  contexts: '/docs/concepts/context-inlining/',
  memos: '/docs/concepts/memo-inlining/',
  conditionals: '/docs/concepts/show-switch/',
  fold: '/docs/concepts/folding/',
};

/**
 * The new place of an option's old anchor, like `optimizer-alwaysInline` for a
 * Vite plugin option or `alwaysInline` for a compile option. The new ids are kebab-case.
 */
function findMovedOption(name: string): string {
  const kebab = name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return kebab.startsWith('optimizer-')
    ? `/docs/reference/vite-options/#${kebab}`
    : `/docs/reference/compile/#${kebab}`;
}

/** Sends a link to an `#anchor` of the old one-page docs to the page that holds it now. */
function followMovedAnchor(): void {
  const id = decodeURIComponent(location.hash.slice(1));
  if (document.getElementById(id)) {
    return;
  }
  const target = id.startsWith('option-') ? findMovedOption(id.slice('option-'.length)) : MOVED[id];
  if (target) {
    location.replace(target);
  }
}

/** Copies the code of a block when its copy button is clicked, with Banig's feedback. */
function copyCode(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target.closest('[data-copy]') : null;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target;
  const code = button.parentElement?.querySelector('pre')?.textContent ?? '';
  function settle(state: 'done' | 'failed'): void {
    button.dataset.state = state;
    button.setAttribute('aria-label', state === 'done' ? 'Copied' : 'Copy failed');
    // A second click restarts the timer.
    clearTimeout(Number(button.dataset.timer));
    button.dataset.timer = String(
      setTimeout(() => {
        button.dataset.state = '';
        button.setAttribute('aria-label', 'Copy');
      }, 1500),
    );
  }
  navigator.clipboard.writeText(code).then(
    () => {
      settle('done');
    },
    () => {
      settle('failed');
    },
  );
}

/** A docs page in Banig's DocsLayout: sidebar tile, prose tile, table of contents. */
export function DocsPage(props: { doc: RenderedDoc }): JSX.Element {
  const siblings = (): ReturnType<typeof findSiblings> => findSiblings(props.doc.slug);

  onSettled(() => {
    if (props.doc.slug === '' && location.hash) {
      followMovedAnchor();
    }
  });

  return (
    <>
      <Header page="docs" slug={props.doc.slug} />
      <div class="docs">
        <aside class="docs-sidebar">
          <DocsNav slug={props.doc.slug} />
        </aside>
        <main id="main" class="docs-main">
          <header class="doc-head">
            <div class="doc-head-meta">
              <Show when={findSectionTitle(props.doc.slug)}>
                {(title) => <p class="crumb">{title()}</p>}
              </Show>
            </div>
            <h1>{props.doc.title}</h1>
            <p class="lead">{props.doc.description}</p>
          </header>
          <article class="prose" innerHTML={props.doc.html} onClick={copyCode} />
          <footer class="doc-foot">
            <a
              class="edit-link"
              href={`${REPOSITORY}/edit/main/${props.doc.file}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="pencil" />
              Edit this page on GitHub
            </a>
            <nav class="pager" aria-label="Pages">
              <Show when={siblings().previous}>
                {(page) => <PagerLink page={page()} rel="prev" />}
              </Show>
              <Show when={siblings().next}>{(page) => <PagerLink page={page()} rel="next" />}</Show>
            </nav>
          </footer>
        </main>
        <TableOfContents doc={props.doc} />
      </div>
      <Footer />
    </>
  );
}
