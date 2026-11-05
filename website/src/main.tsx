import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { render } from '@solidjs/web';
import { App } from './App';
import './styles.css';

const root = document.getElementById('app');
if (root) {
  render(() => <App />, root);
}
