// The search bar in the header, ported from the idlip site. This file only opens the command bar: the bar itself and its
// index load the first time it opens, so a page that never searches does not fetch them.

import type * as PaletteModule from './palette.ts';

const TRIGGER = '.search-trigger';

let palette: Promise<typeof PaletteModule> | undefined;

function openPalette(): void {
  palette ??= import('./palette.ts');
  palette
    .then((module) => {
      module.openPalette();
    })
    .catch(reportError);
}

function isOpen(): boolean {
  return document.querySelector('dialog.command[open]') !== null;
}

/** Whether the focus is in something that takes typed text, so `/` is a character there. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}

document.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest(TRIGGER)) {
    openPalette();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) {
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (isOpen()) {
      palette
        ?.then((module) => {
          module.closePalette();
        })
        .catch(reportError);
    } else {
      openPalette();
    }
  } else if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (!isTyping(event.target) && !isOpen()) {
      event.preventDefault();
      openPalette();
    }
  }
});
