import type { JSX } from '@solidjs/web';
import { For, Show, createSignal, onSettled } from 'solid-js';
import type { HeroExample, HeroStep } from '../lib/hero-player';
import {
  HERO_EXAMPLES,
  captionFor,
  countLines,
  isTemplateLine,
  listStates,
  playHero,
} from '../lib/hero-player';
import { slideThumb } from '../lib/thumb';
import { Icon } from './Icon';

/**
 * The hero visual: an example's JSX, then Solid's compiled output, then the
 * optimizer's passes one step at a time. The page shows the last step, which
 * is also what reduced motion and no JavaScript keep. With motion, the player
 * in `lib/hero-player.ts` takes over once the visual is on screen.
 */
export function HeroSteps(): JSX.Element {
  const [index, setIndex] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const example = (): HeroExample => HERO_EXAMPLES[index()];
  const last = (): HeroStep => example().steps[example().steps.length - 1];
  const first = (): HeroStep => example().steps[0];
  let root: HTMLElement | undefined;
  let picker: HTMLElement | undefined;

  onSettled(() => {
    if (!root) {
      return undefined;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      slideThumb(
        picker ?? root,
        picker?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? undefined,
      );
      return undefined;
    }
    setPlaying(true);
    return playHero(root);
  });

  return (
    <figure
      class="hero-steps"
      ref={(element) => {
        root = element;
      }}
    >
      <div class="hero-steps-bar">
        <div
          class="pills hero-picker"
          data-part="picker"
          aria-label="Example"
          ref={(element) => {
            picker = element;
          }}
        >
          <span class="seg-thumb" />
          <For each={HERO_EXAMPLES}>
            {(item, i) => (
              <button
                type="button"
                class="pill"
                data-index={String(i())}
                aria-pressed={i() === index() ? 'true' : 'false'}
                onClick={() => {
                  // The player handles picks while it runs.
                  if (!playing()) {
                    setIndex(i());
                    slideThumb(
                      picker ?? document.body,
                      picker?.querySelectorAll<HTMLElement>('button')[i()],
                    );
                  }
                }}
              >
                {item.title}
              </button>
            )}
          </For>
        </div>
        <Show when={playing()}>
          <button
            type="button"
            class="icon-button hero-pause"
            data-part="pause"
            data-state="off"
            aria-label="Pause the animation"
            title="Pause the animation"
          >
            <span class="swap">
              <span data-off>
                <Icon name="pause" />
              </span>
              <span data-on>
                <Icon name="play" />
              </span>
            </span>
          </button>
        </Show>
      </div>
      <div class="hero-stage" data-part="stage">
        <ol class="hero-passes" data-part="passes" aria-label="Steps">
          <span class="seg-thumb" />
          <For each={listStates(example())}>
            {(label, i) => (
              <li
                class="hero-pass"
                data-state={i() === listStates(example()).length - 1 ? 'now' : 'done'}
              >
                <Show when={i() >= 2}>
                  <span class="hero-pass-number">{String(i() - 1)}</span>
                </Show>
                {label}
              </li>
            )}
          </For>
        </ol>
        <div class="hero-window">
          <div class="hero-window-head">
            <span data-part="file">Compiled by Solid · App.js</span>
            <span data-part="count">{String(countLines(last()))} lines</span>
          </div>
          <pre class="hero-code" data-part="code" aria-hidden="true">
            <For each={last().code.split('\n')}>
              {(line) => (
                <span class="hero-line">
                  <span class={isTemplateLine(line) ? 'hero-line-text tmpl' : 'hero-line-text'}>
                    {line || ' '}
                  </span>
                </span>
              )}
            </For>
          </pre>
        </div>
        <p class="hero-caption" data-part="caption">
          {captionFor(example(), last().label)}
        </p>
        <div class="hero-counts">
          <span class="hero-count">
            templates{' '}
            <b data-part="templates">{`${String(first().templates)} → ${String(last().templates)}`}</b>
          </span>
          <span class="hero-count">
            lines{' '}
            <b data-part="lines">{`${String(countLines(first()))} → ${String(countLines(last()))}`}</b>
          </span>
        </div>
      </div>
      <figcaption class="visually-hidden">
        {example().title}: Solid compiles the example to {String(countLines(first()))} lines and{' '}
        {String(first().templates)} templates. With solid-optimizer first, it compiles to{' '}
        {String(countLines(last()))} lines and {String(last().templates)} template.
      </figcaption>
    </figure>
  );
}
