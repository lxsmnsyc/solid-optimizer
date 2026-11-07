import type { JSX } from '@solidjs/web';
import { For, createSignal } from 'solid-js';
import demo from '../../../benchmarks/runtime/results.json';
import hackernews from '../../../benchmarks/runtime/results-hackernews.json';
import tracker from '../../../benchmarks/runtime/results-tracker.json';

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

type Entry = Pair & { label: string };

/** What `benchmarks/runtime` writes for one app. */
interface Results {
  date: string;
  runs: number;
  cpu: string;
  browser: string;
  node: string;
  timings: Record<string, Entry & { noise: number }>;
  client: Record<string, Entry>;
  server: Record<string, Entry>;
  hydration: Record<string, Entry>;
}

interface App {
  id: string;
  label: string;
  /** What the benchmark renders. */
  note: string;
  results: Results;
}

const APPS: App[] = [
  {
    id: 'demo',
    label: 'Demo',
    note: 'The demo app with every page rendered at once. It is written to show each pass.',
    results: demo,
  },
  {
    id: 'hackernews',
    label: 'Hacker News',
    note: "Hacker News's two story lists and a story's comments, without its router.",
    results: hackernews,
  },
  {
    id: 'tracker',
    label: 'Tracker',
    note: 'An issue tracker with 40 rows, data under <Loading>, and narrowing <Show> callbacks.',
    results: tracker,
  },
];

// Lower is better for every chart, so each bar's length is its share of the plain build.
function chartsOf(results: Results): Chart[] {
  const charts: Chart[] = [];
  const titles: [string, string, Chart['unit']][] = [
    ['ssr', 'renderToString', 'time'],
    ['hydrate', 'Hydration', 'time'],
    ['coldMount', 'First render', 'time'],
    ['mount', 'Render, warm', 'time'],
    ['heap', 'Heap per app', 'bytes'],
  ];
  for (const [key, title, unit] of titles) {
    const entry = results.timings[key];
    charts.push({ title, unit, pair: entry, noise: entry.noise });
  }
  const counts: [string, string][] = [
    ['nodesCloned', 'Templates cloned'],
    ['owners', 'Owners'],
    ['computations', 'Computations'],
    ['edges', 'Dependency edges'],
  ];
  for (const [key, title] of counts) {
    charts.push({ title, unit: 'count', pair: results.client[key] });
  }
  return charts;
}

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

function collectGroups(results: Results): TableGroup[] {
  const groups: [string, Record<string, Entry>][] = [
    ['Timings', results.timings],
    ['Client render', results.client],
    ['Server render', results.server],
    ['Hydration', results.hydration],
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
        style={{ width: `calc((100% - 84px) * ${String(Math.max(props.share, 0.01))})` }}
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
  const [selected, setSelected] = createSignal(0);
  const app = (): App => {
    const item = APPS.at(selected());
    if (!item) {
      throw new Error('no benchmark app');
    }
    return item;
  };
  return (
    <div class="bench">
      <div class="segmented small bench-apps" aria-label="App">
        <For each={APPS}>
          {(item, index) => (
            <button
              type="button"
              aria-pressed={selected() === index() ? 'true' : 'false'}
              class={['segment', { selected: selected() === index() }]}
              onClick={() => {
                setSelected(index());
              }}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
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
        <For each={chartsOf(app().results)}>
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
          <For each={collectGroups(app().results)}>
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
        {app().note} {app().results.date}. Median of {String(app().results.runs)} runs on{' '}
        {app().results.cpu}, Chromium {app().results.browser.split('.')[0]} and Node{' '}
        {app().results.node}.
      </p>
    </div>
  );
}
