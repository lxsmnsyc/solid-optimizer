import type { JSX } from '@solidjs/web';
import { For, Show, createMemo, createSignal } from 'solid-js';
import examples from '../showcase.json';
import type { Language } from '../lib/highlight';
import { highlight } from '../lib/highlight';
import { replLink } from '../repl/share';

type Example = (typeof examples)[number];
type Side = Example['plain'];
type View = 'jsx' | 'client' | 'server';

interface Stat {
  key: 'templates' | 'components' | 'memos' | 'hydrationKeys' | 'markers' | 'gzip';
  label: string;
  bytes?: boolean;
}

const STATS: Stat[] = [
  { key: 'templates', label: 'templates' },
  { key: 'components', label: 'component calls' },
  { key: 'memos', label: 'memos' },
  { key: 'hydrationKeys', label: 'hydration keys' },
  { key: 'markers', label: 'hydration markers' },
  { key: 'gzip', label: 'client code, gzip', bytes: true },
];

const VIEWS: { id: View; label: string }[] = [
  { id: 'jsx', label: 'JSX' },
  { id: 'client', label: 'Client code' },
  { id: 'server', label: 'Server HTML' },
];

function formatStat(value: number, stat: Stat): string {
  return stat.bytes ? `${String(value)} B` : String(value);
}

/** The label for a count, singular for one. Sizes keep theirs. */
function labelStat(value: number, stat: Stat): string {
  return value === 1 && !stat.bytes ? stat.label.replace(/s$/, '') : stat.label;
}

function sumStat(key: Stat['key'], side: 'plain' | 'after'): number {
  let total = 0;
  for (const example of examples) {
    total += example[side][key];
  }
  return total;
}

/** The share of the plain build that the optimizer removed, as a whole percent. */
function formatSaving(before: number, after: number): string {
  if (before === 0 || before === after) {
    return '';
  }
  const percent = Math.round(((before - after) / before) * 100);
  return percent > 0 ? `−${String(percent)}%` : `+${String(-percent)}%`;
}

const TOTALS: Stat[] = [STATS[0], STATS[1], STATS[3], STATS[5]];

function Totals(): JSX.Element {
  return (
    <div class="totals">
      <For each={TOTALS}>
        {(stat) => {
          const before = sumStat(stat.key, 'plain');
          const after = sumStat(stat.key, 'after');
          return (
            <div class="total">
              <span class="total-values">
                <span class="total-before">{formatStat(before, stat)}</span>
                <span class="total-arrow" aria-hidden="true">
                  →
                </span>
                <span class="total-after">{formatStat(after, stat)}</span>
              </span>
              <span class="total-label">
                {stat.label}
                <span class="total-saving">{formatSaving(before, after)}</span>
              </span>
            </div>
          );
        }}
      </For>
    </div>
  );
}

function CodePane(props: {
  title: string;
  code: string;
  lang: Language;
  side: Side | undefined;
  optimized?: boolean;
}): JSX.Element {
  const html = createMemo(() => highlight(props.code, props.lang));
  return (
    <div class={['compare-pane', { optimized: props.optimized }]}>
      <div class="compare-bar">
        <span class="compare-title">{props.title}</span>
        <Show when={props.side}>
          {(side) => (
            <span class="compare-stats">
              <For each={STATS}>
                {(stat) => (
                  <Show when={side()[stat.key] !== 0 || stat.key === 'templates'}>
                    <span class="chip">
                      <strong>{formatStat(side()[stat.key], stat)}</strong>{' '}
                      {labelStat(side()[stat.key], stat)}
                    </span>
                  </Show>
                )}
              </For>
            </span>
          )}
        </Show>
      </div>
      <div class="compare-code code" innerHTML={html()} />
    </div>
  );
}

export function Showcase(): JSX.Element {
  const [selected, setSelected] = createSignal(examples[0].id);
  const [view, setView] = createSignal<View>('client');

  const example = createMemo((): Example => {
    for (const item of examples) {
      if (item.id === selected()) {
        return item;
      }
    }
    return examples[0];
  });

  const panes = createMemo(() => {
    const current = example();
    switch (view()) {
      case 'jsx':
        return {
          lang: 'tsx' as const,
          before: current.source,
          after: current.optimized,
          beforeTitle: 'Source',
          afterTitle: 'After solid-optimizer, still JSX',
          stats: false,
        };
      case 'server':
        return {
          lang: 'html' as const,
          before: current.plain.html,
          after: current.after.html,
          beforeTitle: 'renderToString, Solid alone',
          afterTitle: 'renderToString, optimized',
          stats: true,
        };
      default:
        return {
          lang: 'tsx' as const,
          before: current.plain.dom,
          after: current.after.dom,
          beforeTitle: 'Solid’s JSX transform alone',
          afterTitle: 'solid-optimizer, then the JSX transform',
          stats: true,
        };
    }
  });

  return (
    <div class="showcase">
      <Totals />
      <div class="showcase-body">
        <div class="showcase-list" role="tablist" aria-label="Examples">
          <For each={examples}>
            {(item) => (
              <button
                type="button"
                role="tab"
                aria-selected={selected() === item.id ? 'true' : 'false'}
                class={['showcase-item', { selected: selected() === item.id }]}
                onClick={() => {
                  setSelected(item.id);
                }}
              >
                <span class="showcase-item-title">{item.title}</span>
                <span class="showcase-item-delta">
                  {item.plain.templates} → {item.after.templates} templates ·{' '}
                  {formatSaving(item.plain.gzip, item.after.gzip) || '0%'} gzip
                </span>
              </button>
            )}
          </For>
        </div>
        <div class="showcase-view" role="tabpanel">
          <div class="showcase-head">
            <p class="showcase-summary">{example().summary}</p>
            <div class="segmented small" aria-label="Output">
              <For each={VIEWS}>
                {(item) => (
                  <button
                    type="button"
                    aria-pressed={view() === item.id ? 'true' : 'false'}
                    class={['segment', { selected: view() === item.id }]}
                    onClick={() => {
                      setView(item.id);
                    }}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          <div class="compare">
            <CodePane
              title={panes().beforeTitle}
              code={panes().before}
              lang={panes().lang}
              side={panes().stats ? example().plain : undefined}
            />
            <CodePane
              title={panes().afterTitle}
              code={panes().after}
              lang={panes().lang}
              side={panes().stats ? example().after : undefined}
              optimized
            />
          </div>
          <a class="showcase-repl" href={replLink([{ name: 'App.tsx', code: example().source }])}>
            Open this example in the REPL →
          </a>
        </div>
      </div>
      <p class="bench-note">
        Each example is one module, compiled by @solidjs/compiler with and without solid-optimizer
        first, and rendered on the server with renderToString. Sizes are the client code before
        minification.
      </p>
    </div>
  );
}
