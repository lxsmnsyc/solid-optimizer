import { For } from 'solid-js';
import { Card } from '../components/Card';

const FEATURES = ['Component inlining', 'Constant folding', 'Control-flow resolution'];

// Loaded lazily, so it lands in its own chunk.
export default function About() {
  return (
    <Card title="About">
      <ul>
        <For each={FEATURES}>{(feature) => <li>{feature}</li>}</For>
      </ul>
    </Card>
  );
}
