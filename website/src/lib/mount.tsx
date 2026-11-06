import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import type { JSX } from '@solidjs/web';
import { render } from '@solidjs/web';
import '../styles.css';

/** Renders a page into `#app`. */
export function mount(Page: () => JSX.Element): void {
  const root = document.getElementById('app');
  if (root) {
    render(() => <Page />, root);
  }
}
