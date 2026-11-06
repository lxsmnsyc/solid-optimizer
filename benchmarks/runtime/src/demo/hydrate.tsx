import { hydrate } from '@solidjs/web';
import { App } from './App';

window.bench = {
  // The counter on the home page.
  probe: { click: '.counter button', watch: '.counter strong' },
  hydrate(element) {
    return hydrate(() => <App />, element);
  },
};
