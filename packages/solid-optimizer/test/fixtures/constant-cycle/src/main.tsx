import { render } from '@solidjs/web';
import { A } from './A';
import { B } from './B';

render(
  () => (
    <main>
      <A />
      <B />
    </main>
  ),
  document.getElementById('app')!,
);
