// The icons of the command bar, on the same grid as the icons of the site: 24px, 1.8px stroke.

function icon(path: string, size = 18): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

const SEARCH_ICONS = {
  search: icon('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  page: icon('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>'),
  hash: icon('<path d="M9 4L7 20M17 4l-2 16M4 9h16M3.5 15h16"/>'),
  theme: icon('<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>'),
  repl: icon('<path d="M4 6l5 6-5 6M12 18h8"/>'),
  enter: icon('<path d="M19 5v7a2 2 0 0 1-2 2H6M10 10l-4 4 4 4"/>', 16),
};

export default SEARCH_ICONS;
