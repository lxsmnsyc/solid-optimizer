import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';

/** Lucide icons the site uses, as the path data of each on Lucide's 24px grid. */
const PATHS = {
  'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
  'arrow-down': ['M12 5v14', 'm19 12-7 7-7-7'],
  check: ['M20 6 9 17l-5-5'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-right': ['m9 18 6-6-6-6'],
  'circle-x': ['M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20', 'm15 9-6 6', 'm9 9 6 6'],
  copy: [
    'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2',
    'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  ],
  github: [
    'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4',
    'M9 18c-4.51 2-5-2-7-2',
  ],
  loader: ['M21 12a9 9 0 1 1-6.219-8.56'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  pause: [
    'M15 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1',
    'M7 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1',
  ],
  pencil: [
    'M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z',
    'm15 5 4 4',
  ],
  play: ['M6 3 20 12 6 21Z'],
  plus: ['M5 12h14', 'M12 5v14'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 1 0 0-14', 'm21 21-4.3-4.3'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8',
    'M12 2v2',
    'M12 20v2',
    'm4.93 4.93 1.41 1.41',
    'm17.66 17.66 1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'm6.34 17.66-1.41 1.41',
    'm19.07 4.93-1.41 1.41',
  ],
  x: ['M18 6 6 18', 'm6 6 12 12'],
} as const;

export type IconName = keyof typeof PATHS;

/** One Lucide icon. It is decorative: the control around it carries the label. */
export function Icon(props: { name: IconName; class?: string }): JSX.Element {
  return (
    <svg
      class={props.class ? `icon ${props.class}` : 'icon'}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <For each={PATHS[props.name]}>{(path) => <path d={path} />}</For>
    </svg>
  );
}
