/**
 * Plays the hero: each example starts as the JSX you write, then Solid's
 * compiled output, then goes through the optimizer's passes one step at a time. In each step, the blocks of Solid's output that change turn red, fold
 * away, and their replacements come in, one block after another.
 *
 * The page renders the last step of the first example. This takes over the
 * DOM of the visual once it is on screen, and leaves it alone with reduced motion.
 */
import hero from '../hero.json';
import { slideThumb } from './thumb';

export type HeroExample = (typeof hero)[number];
export type HeroStep = HeroExample['steps'][number];

export const HERO_EXAMPLES: HeroExample[] = hero;

/** What each step does to its example, in a few words. Keyed by example, then step label. */
export const HERO_CAPTIONS: Record<string, Record<string, string>> = {
  context: {
    'Your code': 'A theme provider, and a card and a badge that read it.',
    'Solid alone': 'Solid compiles each component and the provider on its own.',
    'Inline components': 'Card and Badge join App: one template, the theme read as "dark".',
    'Remove providers': 'Nothing reads Theme at runtime now, so its provider goes.',
    'Fold constants': 'The copies of the theme are constants nothing reads, so they go too.',
  },
  flags: {
    'Your code': 'Build-time flags decide what Show, Switch and Dynamic render.',
    'Solid alone': 'Show, Switch and Dynamic each become a component call.',
    'Lower Show and Switch': 'Show and Switch become ternaries, with no component behind them.',
    'Fold constants': 'The flags are constants, so every branch resolves: one static template.',
  },
  components: {
    'Your code': 'Small components, and a debug panel behind a flag.',
    'Solid alone': 'Four components, five templates.',
    'Inline components': 'Counter, Button and Icon join App’s template.',
    'Lower Show and Switch': 'The debug Show becomes a ternary.',
    'Fold constants': 'DEBUG is false, so the debug branch and its template go.',
  },
};

export const SOURCE_LABEL = 'Your code';

export function captionFor(example: HeroExample, label: string): string {
  return HERO_CAPTIONS[example.id]?.[label] ?? label;
}

/** The states of an example in order: its source, Solid's output, then each pass. */
export function listStates(example: HeroExample): string[] {
  return [SOURCE_LABEL, ...example.steps.map((step) => step.label)];
}

/** Solid's template lines, the part solid-optimizer merges. */
export function isTemplateLine(text: string): boolean {
  return /_\$template\(|^\s*`</.test(text);
}

export function countLines(step: HeroStep): number {
  return step.code.split('\n').length;
}

type Kind = 'same' | 'gone' | 'new';

interface Row {
  text: string;
  kind: Kind;
}

/** A line diff by longest common subsequence: the lines that go and the lines that come. */
function diffLines(before: string[], after: string[]): Row[] {
  const table: Int32Array[] = [];
  for (let i = 0; i <= before.length; i += 1) {
    table.push(new Int32Array(after.length + 1));
  }
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      rows.push({ text: before[i], kind: 'same' });
      i += 1;
      j += 1;
    } else if (j < after.length && (i === before.length || table[i][j + 1] >= table[i + 1][j])) {
      rows.push({ text: after[j], kind: 'new' });
      j += 1;
    } else {
      rows.push({ text: before[i], kind: 'gone' });
      i += 1;
    }
  }
  return rows;
}

/** Whether state `index` of an example is done, current or still to come when `at` plays. */
function describeState(index: number, at: number): 'done' | 'now' | 'todo' {
  if (index < at) {
    return 'done';
  }
  return index === at ? 'now' : 'todo';
}

/** Thrown into a play that a newer play or a pick replaced. */
class Stopped extends Error {}

interface Parts {
  root: HTMLElement;
  picker: HTMLElement;
  pause: HTMLButtonElement;
  stage: HTMLElement;
  passes: HTMLElement;
  code: HTMLElement;
  file: HTMLElement;
  count: HTMLElement;
  caption: HTMLElement;
  templates: HTMLElement;
  lines: HTMLElement;
}

function findPart(root: HTMLElement, name: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[data-part="${name}"]`);
  if (!element) {
    throw new Error(`the hero has no ${name}`);
  }
  return element;
}

function makeLine(text: string, kind?: Kind): HTMLElement {
  const line = document.createElement('span');
  line.className = 'hero-line';
  if (kind) {
    line.dataset.kind = kind;
  }
  if (kind === 'new') {
    line.toggleAttribute('data-hidden', true);
  }
  const inner = document.createElement('span');
  inner.className = isTemplateLine(text) ? 'hero-line-text tmpl' : 'hero-line-text';
  inner.textContent = text || ' ';
  line.append(inner);
  return line;
}

/** Starts the hero in `root`. Returns a function that stops it. */
export function playHero(root: HTMLElement): () => void {
  const parts: Parts = {
    root,
    picker: findPart(root, 'picker'),
    pause:
      root.querySelector<HTMLButtonElement>('[data-part="pause"]') ??
      document.createElement('button'),
    stage: findPart(root, 'stage'),
    passes: findPart(root, 'passes'),
    code: findPart(root, 'code'),
    file: findPart(root, 'file'),
    count: findPart(root, 'count'),
    caption: findPart(root, 'caption'),
    templates: findPart(root, 'templates'),
    lines: findPart(root, 'lines'),
  };
  let run = 0;
  let pausedByReader = false;
  let offScreen = true;

  async function wait(ms: number, mine: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const check = (): void => {
        if (mine !== run) {
          reject(new Stopped());
        } else if (pausedByReader || offScreen) {
          setTimeout(check, 150);
        } else {
          resolve();
        }
      };
      setTimeout(check, ms);
    });
  }

  /** Marks state `at` of the example: 0 is its source, 1 Solid's output, then one per pass. */
  function paintState(example: HeroExample, at: number): void {
    const items = [...parts.passes.querySelectorAll<HTMLElement>('.hero-pass')];
    for (const [index, item] of items.entries()) {
      item.dataset.state = describeState(index, at);
      if (index === at) {
        item.setAttribute('aria-current', 'step');
      } else {
        item.removeAttribute('aria-current');
      }
    }
    slideThumb(parts.passes, items[at]);
  }

  /** Shows the counts of state `at`. A pass's counts show once its changes have played. */
  function paintCounts(example: HeroExample, at: number): void {
    const first = example.steps[0];
    const now = example.steps[Math.max(0, at - 1)];
    parts.templates.textContent = `${String(first.templates)} → ${String(now.templates)}`;
    parts.lines.textContent = `${String(countLines(first))} → ${String(countLines(now))}`;
    if (at === 0) {
      parts.file.textContent = 'Your code · App.tsx';
      parts.count.textContent = `${String(example.source.split('\n').length)} lines`;
    } else {
      parts.file.textContent = 'Compiled by Solid · App.js';
      parts.count.textContent = `${String(countLines(now))} lines`;
    }
  }

  function buildPasses(example: HeroExample): void {
    const thumb = parts.passes.querySelector(':scope > .seg-thumb');
    parts.passes.replaceChildren();
    parts.passes.removeAttribute('data-ready');
    if (thumb) {
      parts.passes.append(thumb);
    }
    // The source and Solid's output lead; the passes are numbered.
    for (const [index, label] of listStates(example).entries()) {
      const item = document.createElement('li');
      item.className = 'hero-pass';
      if (index >= 2) {
        const number = document.createElement('span');
        number.className = 'hero-pass-number';
        number.textContent = String(index - 1);
        item.append(number);
      }
      item.append(label);
      parts.passes.append(item);
    }
  }

  async function setCaption(text: string, mine: number): Promise<void> {
    parts.caption.toggleAttribute('data-out', true);
    await wait(180, mine);
    parts.caption.textContent = text;
    parts.caption.removeAttribute('data-out');
  }

  function scrollCode(top: number): void {
    parts.code.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  async function playExample(index: number, mine: number): Promise<void> {
    const example = HERO_EXAMPLES[index];
    const buttons = [...parts.picker.querySelectorAll<HTMLElement>('button')];
    for (const [i, button] of buttons.entries()) {
      button.setAttribute('aria-pressed', String(i === index));
    }
    slideThumb(parts.picker, buttons[index]);
    // The old example slides out to the left, the new one in from the right.
    parts.stage.toggleAttribute('data-leave', true);
    await wait(280, mine);
    parts.stage.removeAttribute('data-leave');
    parts.stage.toggleAttribute('data-enter', true);
    buildPasses(example);
    parts.code.replaceChildren(...example.source.split('\n').map((text) => makeLine(text)));
    parts.code.scrollTop = 0;
    parts.caption.textContent = captionFor(example, SOURCE_LABEL);
    paintState(example, 0);
    paintCounts(example, 0);
    // Lay the new content out at its start position, then slide it in.
    parts.stage.getBoundingClientRect();
    parts.stage.removeAttribute('data-enter');
    await wait(2800, mine);
    // Solid compiles it: the source gives way to Solid's output.
    const first = example.steps[0];
    parts.code.toggleAttribute('data-swap', true);
    paintState(example, 1);
    paintCounts(example, 1);
    await setCaption(captionFor(example, first.label), mine);
    await wait(120, mine);
    parts.code.replaceChildren(...first.code.split('\n').map((text) => makeLine(text)));
    parts.code.scrollTop = 0;
    parts.code.removeAttribute('data-swap');
    await wait(2400, mine);
    for (let at = 1; at < example.steps.length; at += 1) {
      const step = example.steps[at];
      paintState(example, at + 1);
      await setCaption(captionFor(example, step.label), mine);
      const rows = diffLines(example.steps[at - 1].code.split('\n'), step.code.split('\n'));
      const lines = rows.map((row) => makeLine(row.text, row.kind));
      parts.code.replaceChildren(...lines);
      // Changed lines next to each other form a block. Blocks play one after another.
      const blocks: HTMLElement[][] = [];
      let last = -2;
      for (const [i, line] of lines.entries()) {
        if (line.dataset.kind === 'same') {
          continue;
        }
        if (i === last + 1) {
          blocks.at(-1)?.push(line);
        } else {
          blocks.push([line]);
        }
        last = i;
      }
      await wait(400, mine);
      for (const block of blocks) {
        const gone = block.filter((line) => line.dataset.kind === 'gone');
        const added = block.filter((line) => line.dataset.kind === 'new');
        scrollCode(block[0].offsetTop - 60);
        for (const line of gone) {
          line.dataset.tint = 'gone';
        }
        if (gone.length > 0) {
          await wait(520, mine);
          for (const line of gone) {
            line.toggleAttribute('data-hidden', true);
          }
          await wait(380, mine);
        }
        for (const line of added) {
          line.dataset.tint = 'new';
          line.removeAttribute('data-hidden');
        }
        if (added.length > 0) {
          await wait(420, mine);
        }
      }
      paintCounts(example, at + 1);
      scrollCode(0);
      await wait(1800, mine);
      for (const line of lines) {
        delete line.dataset.tint;
      }
    }
    await wait(2600, mine);
  }

  async function loop(start: number): Promise<void> {
    run += 1;
    const mine = run;
    try {
      for (let index = start; ; index = (index + 1) % HERO_EXAMPLES.length) {
        await playExample(index, mine);
      }
    } catch (error) {
      if (!(error instanceof Stopped)) {
        throw error;
      }
    }
  }

  function pick(event: MouseEvent): void {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    const index = Number(button?.dataset.index);
    if (button && Number.isInteger(index)) {
      loop(index).catch(reportError);
    }
  }

  function togglePause(): void {
    pausedByReader = !pausedByReader;
    parts.pause.dataset.state = pausedByReader ? 'on' : 'off';
    parts.pause.setAttribute(
      'aria-label',
      pausedByReader ? 'Play the animation' : 'Pause the animation',
    );
    parts.pause.title = parts.pause.getAttribute('aria-label') ?? '';
  }

  function placeThumbs(): void {
    slideThumb(
      parts.picker,
      parts.picker.querySelector<HTMLElement>('[aria-pressed="true"]') ?? undefined,
    );
    slideThumb(
      parts.passes,
      parts.passes.querySelector<HTMLElement>('[data-state="now"]') ?? undefined,
    );
  }

  parts.picker.addEventListener('click', pick);
  parts.pause.addEventListener('click', togglePause);
  window.addEventListener('resize', placeThumbs);
  placeThumbs();
  // It plays only while it is on screen.
  const observer = new IntersectionObserver(
    ([entry]) => {
      offScreen = !entry.isIntersecting;
    },
    { threshold: 0.2 },
  );
  observer.observe(root);
  loop(0).catch(reportError);

  return () => {
    run += 1;
    observer.disconnect();
    parts.picker.removeEventListener('click', pick);
    parts.pause.removeEventListener('click', togglePause);
    window.removeEventListener('resize', placeThumbs);
  };
}
