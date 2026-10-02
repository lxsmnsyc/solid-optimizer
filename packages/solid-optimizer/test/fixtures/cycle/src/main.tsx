import { render } from '@solidjs/web';
import { A } from './A';

render(() => <A depth={3} />, document.getElementById('app')!);
