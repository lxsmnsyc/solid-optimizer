import { hydrate } from '@solidjs/web';
import { App } from './App';

window.bench = {
  // The first comment's collapse toggle.
  probe: { click: '.toggle a', watch: '.toggle a' },
  hydrate(element) {
    return hydrate(() => <App />, element);
  },
};
