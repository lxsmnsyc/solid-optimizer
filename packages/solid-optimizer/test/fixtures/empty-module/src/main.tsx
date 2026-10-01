import { render } from '@solidjs/web';
// A library build can leave a module with no code, like Kobalte's chunks.
import './empty.jsx';

render(() => <p>rendered</p>, document.getElementById('app')!);
