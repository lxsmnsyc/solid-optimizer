// The command bar, ported from the idlip site. `bind.ts` imports this file the first time the bar opens, so pages that
// never open it do not load it. The bar is a modal `<dialog>`: the browser traps focus in it, makes
// the page behind it inert and closes it on Escape.
import type { Entry } from './entry.ts';
import SEARCH_ICONS from './icons.ts';
import './palette.css';
import { holdsAll, markTerms, search, splitTerms, titleOf } from './rank.ts';
import { emptyMessage, renderEmpty, resultsStatus } from './view.ts';

interface Item {
  title: string;
  detail: string;
  icon: string;
  /** Matching words to highlight in the title and the detail. */
  terms: string[];
  run: () => void;
}

/** The lifecycle of the index: not asked for, loading, loaded or failed. A failed load is tried again. */
type Index =
  | { state: 'idle' }
  | { state: 'loading'; promise: Promise<void> }
  | { state: 'ready'; entries: Entry[] }
  | { state: 'failed' };

const BASE = import.meta.env.BASE_URL;
const START_PAGES = 5;

let dialog: HTMLDialogElement | undefined;
let field: HTMLInputElement;
let list: HTMLUListElement;
let status: HTMLElement;
let index: Index = { state: 'idle' };
let items: Item[] = [];
let rows: HTMLElement[] = [];
let active = 0;

function isEntries(value: unknown): value is Entry[] {
  return Array.isArray(value);
}

/** Fetches the index. It never rejects: a failure is a state of the index. */
async function fetchIndex(): Promise<void> {
  try {
    const response = await fetch(`${BASE}search-index.json`);
    const value: unknown = await response.json();
    index = isEntries(value) ? { state: 'ready', entries: value } : { state: 'failed' };
  } catch {
    index = { state: 'failed' };
  }
  render();
}

/** Starts the load when the index is not loaded and not loading. */
function loadIndex(): void {
  if (index.state === 'idle' || index.state === 'failed') {
    index = { state: 'loading', promise: fetchIndex() };
    render();
  }
}

function go(address: string): void {
  closePalette();
  location.assign(address);
}

/** The commands of the page: the theme switch, and the REPL when the header links to it. */
function listCommands(): Item[] {
  const commands: Item[] = [
    {
      title: 'Switch the theme',
      detail: 'Light or dark',
      icon: SEARCH_ICONS.theme,
      terms: [],
      run() {
        closePalette();
        document.querySelector<HTMLElement>('.theme-button')?.click();
      },
    },
  ];
  const repl = document.querySelector<HTMLAnchorElement>('.site-nav a[href*="repl"]');
  if (repl !== null) {
    commands.push({
      title: 'Open the REPL',
      detail: 'Run solid-optimizer and Solid’s compiler in the browser',
      icon: SEARCH_ICONS.repl,
      terms: [],
      run: () => {
        go(repl.href);
      },
    });
  }
  return commands;
}

function pageItem(entry: Entry, terms: string[], detail: string): Item {
  const isPage = entry.id === '';
  return {
    title: titleOf(entry),
    detail: isPage ? detail : `${entry.pageTitle}  ·  ${detail}`,
    icon: isPage ? SEARCH_ICONS.page : SEARCH_ICONS.hash,
    terms,
    run: () => {
      go(`${BASE}${entry.page}${isPage ? '' : `#${entry.id}`}`);
    },
  };
}

/** The items for the query: pages and headings that match, then the commands that match. */
function listItems(entries: readonly Entry[], query: string): Item[] {
  const terms = splitTerms(query);
  const commands = listCommands();
  if (terms.length === 0) {
    const start: Item[] = [];
    for (const entry of entries) {
      if (entry.id === '' && start.length < START_PAGES) {
        start.push(pageItem(entry, [], entry.text.slice(0, 90)));
      }
    }
    return [...start, ...commands];
  }
  // A command that matches matches by its title, so it comes before the pages.
  const found: Item[] = [];
  for (const command of commands) {
    if (holdsAll(command.title, terms)) {
      found.push({ ...command, terms: markTerms(terms) });
    }
  }
  for (const result of search(entries, query)) {
    found.push(pageItem(result.entry, markTerms(terms), result.detail));
  }
  return found;
}

function escapePattern(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Appends text with the matching words wrapped in `<mark>`. */
function appendMarked(parent: HTMLElement, text: string, terms: readonly string[]): void {
  if (terms.length === 0) {
    parent.append(text);
    return;
  }
  // The longest term goes first, so a term that holds another one wins.
  const escaped: string[] = [];
  for (const term of terms.toSorted((a, b) => b.length - a.length)) {
    escaped.push(escapePattern(term));
  }
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  let from = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(text.slice(from, match.index));
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    parent.append(mark);
    from = match.index + match[0].length;
  }
  parent.append(text.slice(from));
}

function createOption(item: Item, at: number): HTMLLIElement {
  const option = document.createElement('li');
  option.id = `command-option-${at}`;
  option.className = 'command-option';
  option.setAttribute('role', 'option');
  option.setAttribute('aria-selected', 'false');
  option.dataset.at = String(at);

  const icon = document.createElement('span');
  icon.className = 'command-icon';
  icon.innerHTML = item.icon;

  const body = document.createElement('span');
  body.className = 'command-body';
  const title = document.createElement('span');
  title.className = 'command-title';
  appendMarked(title, item.title, item.terms);
  const detail = document.createElement('span');
  detail.className = 'command-detail';
  appendMarked(detail, item.detail, item.terms);
  body.append(title, detail);

  const hint = document.createElement('span');
  hint.className = 'command-enter';
  hint.innerHTML = SEARCH_ICONS.enter;

  option.append(icon, body, hint);
  return option;
}

/** Makes one option the current one: the highlighted row, and the one a screen reader reads. */
function setActive(at: number): void {
  if (active < rows.length) {
    rows[active].setAttribute('aria-selected', 'false');
  }
  active = at;
  if (at >= rows.length) {
    field.removeAttribute('aria-activedescendant');
    return;
  }
  rows[at].setAttribute('aria-selected', 'true');
  field.setAttribute('aria-activedescendant', rows[at].id);
  rows[at].scrollIntoView({ block: 'nearest' });
}

function showMessage(text: string): void {
  const row = document.createElement('li');
  row.className = 'command-message';
  row.setAttribute('role', 'presentation');
  row.textContent = text;
  list.append(row);
}

function showEmpty(query: string, guide: string | undefined): void {
  const row = document.createElement('li');
  row.className = 'command-message';
  row.setAttribute('role', 'presentation');
  row.innerHTML = renderEmpty(query, guide);
  list.append(row);
}

/** Draws the list for the current query and index. */
function render(): void {
  if (dialog === undefined) {
    return;
  }
  list.replaceChildren();
  items = [];
  rows = [];
  field.setAttribute('aria-expanded', 'false');
  if (index.state === 'loading') {
    showMessage('Loading the index…');
    status.textContent = 'Loading the index';
    return;
  }
  if (index.state === 'idle') {
    return;
  }
  if (index.state === 'failed') {
    showMessage('The search index did not load. Close the bar and open it to try again.');
    status.textContent = 'The search index did not load';
    return;
  }
  items = listItems(index.entries, field.value);
  if (items.length === 0) {
    const guide = index.entries.length > 0 ? `${BASE}${index.entries[0].page}` : undefined;
    showEmpty(field.value, guide);
    status.textContent = emptyMessage(field.value);
    field.removeAttribute('aria-activedescendant');
    return;
  }
  for (const [at, item] of items.entries()) {
    const row = createOption(item, at);
    rows.push(row);
    list.append(row);
  }
  field.setAttribute('aria-expanded', 'true');
  status.textContent = resultsStatus(field.value, items.length);
  active = 0;
  setActive(0);
}

function move(step: number): void {
  if (items.length > 0) {
    setActive((active + step + items.length) % items.length);
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    move(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    move(-1);
  } else if (event.key === 'Enter' && event.target === field) {
    event.preventDefault();
    items[active]?.run();
  }
}

function onPointer(event: MouseEvent): void {
  const option =
    event.target instanceof Element ? event.target.closest<HTMLElement>('.command-option') : null;
  if (option !== null) {
    const at = Number(option.dataset.at);
    if (event.type === 'click') {
      items[at]?.run();
    } else if (at !== active) {
      setActive(at);
    }
  } else if (event.type === 'click' && event.target === dialog) {
    // A click on the backdrop lands on the dialog itself, which has no padding.
    closePalette();
  }
}

function createDialog(): HTMLDialogElement {
  const root = document.createElement('dialog');
  root.className = 'command';
  root.setAttribute('aria-label', 'Search the documentation');
  root.innerHTML = `<div class="command-field">${SEARCH_ICONS.search}<input class="command-input" type="text" role="combobox" aria-label="Search the documentation" aria-autocomplete="list" aria-expanded="false" aria-controls="command-list" placeholder="Search the documentation" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go"><kbd>esc</kbd></div><ul class="command-list" id="command-list" role="listbox" aria-label="Results"></ul><p class="visually-hidden" role="status"></p>`;
  field = root.querySelector('input')!;
  list = root.querySelector('ul')!;
  status = root.querySelector('[role="status"]')!;
  field.addEventListener('input', render);
  root.addEventListener('keydown', onKeydown);
  root.addEventListener('click', onPointer);
  list.addEventListener('pointermove', onPointer);
  root.addEventListener('close', () => {
    field.value = '';
    // The browser returns focus to what had it before, which is the page for `/` and Cmd+K.
    document.querySelector<HTMLElement>('.search-trigger')?.focus();
  });
  document.body.append(root);
  return root;
}

/** Opens the command bar, and loads the index the first time. */
export function openPalette(): void {
  dialog ??= createDialog();
  if (dialog.open) {
    return;
  }
  dialog.showModal();
  render();
  field.focus();
  loadIndex();
}

/** Closes the command bar. */
export function closePalette(): void {
  dialog?.close();
}
