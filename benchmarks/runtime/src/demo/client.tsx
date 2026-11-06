import { render } from '@solidjs/web';
import { App } from './App';

window.bench = {
  mount(element) {
    return render(() => <App />, element);
  },
};
