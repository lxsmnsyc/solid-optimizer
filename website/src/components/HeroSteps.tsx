import type { JSX } from '@solidjs/web';
import { For, Show, createSignal, onSettled } from 'solid-js';
import type { HeroExample, HeroStep } from '../lib/hero-player';
import {
  HERO_EXAMPLES,
  OUTPUT_LABEL,
  captionFor,
  countLines,
  highlightLines,
  listStates,
  playHero,
} from '../lib/hero-player';
import { slideThumb } from '../lib/thumb';
import { Icon } from './Icon';

/**
 * The hero visual: an example's JSX, the JSX after each optimizer pass, then
 * what Solid's JSX transform makes of it. The page shows that last step,
 * which is also what reduced motion and no JavaScript keep. With motion, the
 * player in `lib/hero-player.ts` takes over once the visual is on screen.
 */
export function HeroSteps(): JSX.Element {
  const [index, setIndex] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const example = (): HeroExample => HERO_EXAMPLES[index()];
  const first = (): HeroStep => example().steps[0];
  const last = (): HeroStep => example().steps[example().steps.length - 1];
  const labels = (): string[] => listStates(example());
  let root: HTMLElement | undefined;
  let picker: HTMLElement | undefined;

  function placePicker(): void {
    if (picker) {
      slideThumb(picker, picker.querySelector<HTMLElement>('[aria-pressed="true"]') ?? undefined);
    }
  }

  onSettled(() => {
    if (!root) {
      return undefined;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      placePicker();
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
                    requestAnimationFrame(placePicker);
                  }
                }}
              >
                {item.title}
              </button>
            )}
          </For>
        </div>
        <button
          type="button"
          class="icon-button hero-pause"
          data-part="pause"
          data-state="off"
          aria-label="Pause the animation"
          title="Pause the animation"
          hidden={!playing()}
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
      </div>
      <div class="hero-stage" data-part="stage">
        <ol class="hero-passes" data-part="passes" aria-label="Steps">
          <span class="seg-thumb" />
          <For each={labels()}>
            {(label, i) => (
              <li
                class="hero-pass"
                data-state={label === OUTPUT_LABEL ? 'now' : 'done'}
                aria-current={label === OUTPUT_LABEL ? 'step' : undefined}
              >
                <Show when={i() > 0 && i() < labels().length - 1}>
                  <span class="hero-pass-number">{String(i())}</span>
                </Show>
                {label}
              </li>
            )}
          </For>
        </ol>
        <div class="hero-window">
          <div class="hero-window-head">
            <span data-part="file">Compiled by Solid · App.js</span>
            <span data-part="count">{String(countLines(example().output))} lines</span>
          </div>
          <pre class="hero-code twinkleplop" data-part="code" aria-hidden="true">
            <For each={highlightLines(example().output)}>
              {(html) => (
                <span class="hero-line">
                  <span class="hero-line-text" innerHTML={html || ' '} />
                </span>
              )}
            </For>
          </pre>
        </div>
        <p class="hero-caption" data-part="caption">
          {captionFor(example(), OUTPUT_LABEL)}
        </p>
        <div class="hero-counts">
          <span class="hero-count">
            templates{' '}
            <b data-part="templates">{`${String(first().templates)} → ${String(last().templates)}`}</b>
          </span>
          <span class="hero-count">
            component calls{' '}
            <b data-part="components">{`${String(first().components)} → ${String(last().components)}`}</b>
          </span>
        </div>
      </div>
      <figcaption class="visually-hidden">
        {example().title}: solid-optimizer rewrites the JSX in {String(example().steps.length - 1)}{' '}
        passes. Solid then compiles it to {String(last().templates)} templates and{' '}
        {String(last().components)} component calls, down from {String(first().templates)} and{' '}
        {String(first().components)}.
      </figcaption>
    </figure>
  );
}
