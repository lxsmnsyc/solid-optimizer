import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';
import results from '../../../benchmarks/runtime/results.json';

interface Pair {
  plain: number;
  optimized: number;
}

interface Chart {
  title: string;
  unit: 'time' | 'bytes' | 'count';
  pair: Pair;
  /** The noise of a timing, the larger median absolute deviation of the two sides. */
  noise?: number;
}

const { timings, client, server, hydration } = results;

// Lower is better for every chart, so each bar's length is its share of the plain build.
const CHARTS: Chart[] = [
  { title: 'renderToString', unit: 'time', pair: timings.ssr, noise: timings.ssr.noise },
  { title: 'Hydration', unit: 'time', pair: timings.hydrate, noise: timings.hydrate.noise },
  { title: 'First render', unit: 'time', pair: timings.coldMount, noise: timings.coldMount.noise },
  { title: 'Render, warm', unit: 'time', pair: timings.mount, noise: timings.mount.noise },
  { title: 'Heap per app', unit: 'bytes', pair: timings.heap, noise: timings.heap.noise },
  { title: 'Templates cloned', unit: 'count', pair: client.nodesCloned },
];

interface TableRow {
  label: string;
  plain: string;
  optimized: string;
  change: string;
}

function formatValue(value: number, unit: Chart['unit']): string {
  if (unit === 'time') {
    return value >= 1000 ? `${(value / 1000).toFixed(2)} ms` : `${value.toFixed(1)} µs`;
  }
  if (unit === 'bytes') {
    return value >= 1000 ? `${(value / 1000).toFixed(1)} kB` : `${String(Math.round(value))} B`;
  }
  return String(value);
}

function formatChange(pair: Pair): string {
  if (pair.plain === pair.optimized) {
    return '0%';
  }
  const percent = ((pair.optimized - pair.plain) / pair.plain) * 100;
  return `${percent > 0 ? '+' : '−'}${Math.abs(percent).toFixed(0)}%`;
}

interface TableGroup {
  title: string;
  rows: TableRow[];
}

/** A row of the table, with the unit moved from the label into the values. */
function toRow(entry: Pair & { label: string }): TableRow {
  const label = entry.label.replaceAll('`', '');
  const match = /^(.*) \((µs|B|gzip, B)\)$/.exec(label);
  if (!match) {
    return {
      label,
      plain: formatValue(entry.plain, 'count'),
      optimized: formatValue(entry.optimized, 'count'),
      change: formatChange(entry),
    };
  }
  const [, base, suffix] = match;
  const unit = suffix === 'µs' ? 'time' : 'bytes';
  const name = suffix === 'gzip, B' ? `${base}, gzip` : base;
  return {
    label: name,
    plain: formatValue(entry.plain, unit),
    optimized: formatValue(entry.optimized, unit),
    change: formatChange(entry),
  };
}

function collectGroups(): TableGroup[] {
  const groups: [string, Record<string, Pair & { label: string }>][] = [
    ['Timings', timings],
    ['Client render', client],
    ['Server render', server],
    ['Hydration', hydration],
  ];
  const result: TableGroup[] = [];
  for (const [title, entries] of groups) {
    const rows: TableRow[] = [];
    for (const entry of Object.values(entries)) {
      rows.push(toRow(entry));
    }
    result.push({ title, rows });
  }
  return result;
}

function Bar(props: {
  name: string;
  variant: 'plain' | 'optimized';
  value: number;
  share: number;
  chart: Chart;
}): JSX.Element {
  const text = formatValue(props.value, props.chart.unit);
  const noise =
    props.chart.noise === undefined ? '' : ` ±${formatValue(props.chart.noise, props.chart.unit)}`;
  return (
    <div class="bench-bar" tabindex="0" aria-label={`${props.chart.title}, ${props.name}: ${text}`}>
      <span
        class={`bench-fill ${props.variant}`}
        style={{ width: `${String(Math.max(props.share * 100, 1))}%` }}
      />
      <span class="bench-value">{text}</span>
      <span class="bench-tip" role="tooltip">
        <strong>
          {text}
          {noise}
        </strong>
        <span>{props.name}</span>
      </span>
    </div>
  );
}

export function Benchmarks(): JSX.Element {
  return (
    <div class="bench">
      <div class="bench-legend">
        <span>
          <i class="bench-key plain" />
          @solidjs/vite-plugin
        </span>
        <span>
          <i class="bench-key optimized" />
          solid-optimizer
        </span>
      </div>
      <div class="bench-grid">
        <For each={CHARTS}>
          {(chart) => (
            <figure class="bench-card">
              <figcaption>
                <h3>{chart.title}</h3>
                <span class="bench-change">{formatChange(chart.pair)}</span>
              </figcaption>
              <Bar
                name="@solidjs/vite-plugin"
                variant="plain"
                value={chart.pair.plain}
                share={1}
                chart={chart}
              />
              <Bar
                name="solid-optimizer"
                variant="optimized"
                value={chart.pair.optimized}
                share={chart.pair.optimized / chart.pair.plain}
                chart={chart}
              />
            </figure>
          )}
        </For>
      </div>
      <details class="bench-table">
        <summary>Every measure</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">@solidjs/vite-plugin</th>
              <th scope="col">solid-optimizer</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <For each={collectGroups()}>
            {(group) => (
              <tbody>
                <tr class="bench-group">
                  <th scope="rowgroup" colspan="4">
                    {group.title}
                  </th>
                </tr>
                <For each={group.rows}>
                  {(row) => (
                    <tr>
                      <th scope="row">{row.label}</th>
                      <td>{row.plain}</td>
                      <td>{row.optimized}</td>
                      <td>{row.change}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            )}
          </For>
        </table>
      </details>
      <p class="bench-note">
        The demo app with every page rendered at once, {results.date}. Median of{' '}
        {String(results.runs)} runs on {results.cpu}, Chromium {results.browser.split('.')[0]} and
        Node {results.node}. The demo is written to show each pass; on Hacker News the bundle
        shrinks by 3% at most, so expect less there.
      </p>
    </div>
  );
}
