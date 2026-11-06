import { generateHydrationScript, renderToString } from '@solidjs/web';
import { App } from './App';

export function render(): string {
  return renderToString(() => <App />);
}

export function hydrationScript(): string {
  return generateHydrationScript();
}
