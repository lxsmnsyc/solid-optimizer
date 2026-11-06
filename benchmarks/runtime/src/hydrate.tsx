import { hydrate } from '@solidjs/web';
import { App } from './App';

window.bench = {
  hydrate(element) {
    return hydrate(() => <App />, element);
  },
};
