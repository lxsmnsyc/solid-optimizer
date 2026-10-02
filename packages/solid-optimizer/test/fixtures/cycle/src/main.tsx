import { render } from 'solid-js/web';
import { A } from './A';

render(() => <A depth={3} />, document.getElementById('app')!);
