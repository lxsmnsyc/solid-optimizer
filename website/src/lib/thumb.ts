/** Moves a pill group's thumb onto its selected item. Only the position animates. */
export function slideThumb(group: HTMLElement, item: HTMLElement | undefined): void {
  const thumb = group.querySelector<HTMLElement>(':scope > .seg-thumb');
  if (!thumb || !item) {
    return;
  }
  thumb.style.setProperty('--seg-x', `${String(item.offsetLeft)}px`);
  thumb.style.setProperty('--seg-y', `${String(item.offsetTop)}px`);
  thumb.style.setProperty('--seg-w', `${String(item.offsetWidth)}px`);
  thumb.style.setProperty('--seg-h', `${String(item.offsetHeight)}px`);
  // Transitions start after the first placement, so nothing slides on first paint.
  if (!group.hasAttribute('data-ready')) {
    requestAnimationFrame(() => {
      group.toggleAttribute('data-ready', true);
    });
  }
}
