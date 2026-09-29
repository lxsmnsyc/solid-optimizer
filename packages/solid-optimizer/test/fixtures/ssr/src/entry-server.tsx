import { renderToString } from '@solidjs/web';
import { App } from './App';

export function render(): string {
  return renderToString(() => <App />);
}
