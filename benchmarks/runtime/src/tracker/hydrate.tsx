import { hydrate } from '@solidjs/web';
import { App } from './App';

window.bench = {
  // The first row's star.
  probe: { click: '.issues li:nth-child(1) .star', watch: '.issues li:nth-child(1) .star' },
  hydrate(element) {
    return hydrate(() => <App />, element);
  },
};
