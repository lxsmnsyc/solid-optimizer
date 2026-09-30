import { For } from 'solid-js';
import { Card } from './Card';

export default function Page() {
  return (
    <Card title="Lazy">
      <ul>
        <For each={['a', 'b']}>{(item) => <li>{item}</li>}</For>
      </ul>
    </Card>
  );
}
