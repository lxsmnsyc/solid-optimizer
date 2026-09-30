import { For } from 'solid-js';
import { Legend } from '../components/Legend';

const POINTS = [3, 7, 4, 9];

// Loaded lazily from the dashboard, so it is a chunk inside a lazy chunk.
export default function Chart() {
  return (
    <figure class="chart">
      <svg viewBox="0 0 40 10" role="img">
        <For each={POINTS}>
          {(point, index) => <rect x={index() * 10} y={10 - point} width="8" height={point} />}
        </For>
      </svg>
      <Legend items={['visits', 'signups']} />
    </figure>
  );
}
