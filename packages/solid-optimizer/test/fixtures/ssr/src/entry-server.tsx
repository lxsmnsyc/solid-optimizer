import { renderToString } from 'solid-js/web';
import { App } from './App';

export function render(): string {
  return renderToString(() => <App />);
}
