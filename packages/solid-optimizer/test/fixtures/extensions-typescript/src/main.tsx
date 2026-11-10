import { render } from '@solidjs/web';
import { Title } from './Title.tview';

render(() => <Title label="Hello" />, document.getElementById('app')!);
