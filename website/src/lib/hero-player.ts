/**
 * Plays the hero: each example starts as the JSX you write, then goes through
 * the optimizer's passes one at a time. solid-optimizer works on JSX, so each
 * step shows the JSX it writes: the blocks that change turn red, fold away,
 * and their replacements come in, one block after another. The last step is
 * what Solid's JSX transform makes of the result.
 *
 * The page renders that last step for the first example. This takes over the
 * DOM of the visual once it is on screen, and leaves it alone with reduced motion.
 */
import hero from '../hero.json';
import { highlight } from './highlight';
import { slideThumb } from './thumb';

export type HeroExample = (typeof hero)[number];
export type HeroStep = HeroExample['steps'][number];

export const HERO_EXAMPLES: HeroExample[] = hero;

/** The last step: Solid's JSX transform compiles the optimized JSX. */
export const OUTPUT_LABEL = 'Solid compiles it';

/** What each step does to its example, in a few words. Keyed by example, then step label. */
const CAPTIONS: Record<string, Record<string, string>> = {
  context: {
    'Your code': 'A theme provider, and a card and a badge that read it.',
    'Inline components': 'Card and Badge become plain JSX in App, with the theme read as "dark".',
    'Remove providers': 'Nothing reads Theme at runtime now, so its provider goes.',
    'Fold constants': 'The theme folds into the class names.',
  },
  flags: {
    'Your code': 'Build-time flags decide what Show, Switch and Dynamic render.',
    'Lower Show and Switch': 'Show and Switch become ternaries, with no component behind them.',
    'Fold constants': 'The flags are constants, so each branch resolves and Dynamic becomes an h2.',
  },
  components: {
    'Your code': 'Small components, and a debug panel behind a flag.',
    'Inline components': 'Counter, Button and Icon become plain JSX in App.',
    'Lower Show and Switch': 'The debug Show becomes a ternary.',
    'Fold constants': 'DEBUG is false, so the debug branch goes.',
  },
};

function pluralize(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`;
}

export function captionFor(example: HeroExample, label: string): string {
  if (label === OUTPUT_LABEL) {
    const first = example.steps[0];
    const last = example.steps[example.steps.length - 1];
    return `Solid compiles it to ${pluralize(last.templates, 'template')} and ${pluralize(last.components, 'component call')}, down from ${String(first.templates)} and ${String(first.components)}.`;
  }
  return CAPTIONS[example.id]?.[label] ?? label;
}

/** The labels of an example's steps in order: its source, each pass, then Solid's output. */
export function listStates(example: HeroExample): string[] {
  return [...example.steps.map((step) => step.label), OUTPUT_LABEL];
}

export function countLines(text: string): number {
  return text.split('\n').length;
}

/**
 * Highlights code and returns the HTML of each line. twinkleplop wraps each
 * line in its own element and closes every token at the end of a line, so a
 * token that spans lines, like a template string, keeps its color on each.
 */
export function highlightLines(code: string): string[] {
  const html = highlight(code, 'tsx');
  const start = html.indexOf('<code>') + '<code>'.length;
  const end = html.lastIndexOf('</code>');
  const lines = html.slice(start, end).split('\n');
  // Fall back to plain text if the lines do not match, so the diff stays right.
  if (lines.length !== countLines(code)) {
    return code.split('\n').map(escapeHTML);
  }
  return lines;
}

function escapeHTML(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

type Kind = 'same' | 'gone' | 'new';

interface Row {
  text: string;
  html: string;
  kind: Kind;
}

/** A line diff by longest common subsequence: the lines that go and the lines that come. */
function diffLines(
  before: string[],
  after: string[],
  beforeHTML: string[],
  afterHTML: string[],
): Row[] {
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
      rows.push({ text: before[i], html: beforeHTML[i], kind: 'same' });
      i += 1;
      j += 1;
    } else if (j < after.length && (i === before.length || table[i][j + 1] >= table[i + 1][j])) {
      rows.push({ text: after[j], html: afterHTML[j], kind: 'new' });
      j += 1;
    } else {
      rows.push({ text: before[i], html: beforeHTML[i], kind: 'gone' });
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
  picker: HTMLElement;
  pause: HTMLElement;
  stage: HTMLElement;
  passes: HTMLElement;
  code: HTMLElement;
  file: HTMLElement;
  count: HTMLElement;
  caption: HTMLElement;
  templates: HTMLElement;
  components: HTMLElement;
}

function findPart(root: HTMLElement, name: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[data-part="${name}"]`);
  if (!element) {
    throw new Error(`the hero has no ${name}`);
  }
  return element;
}

/** One line of the code window. `html` is the line as `highlightLines` writes it. */
function makeLine(html: string, kind?: Kind): HTMLElement {
  const line = document.createElement('span');
  line.className = 'hero-line';
  if (kind) {
    line.dataset.kind = kind;
  }
  if (kind === 'new') {
    line.toggleAttribute('data-hidden', true);
  }
  const inner = document.createElement('span');
  inner.className = 'hero-line-text';
  inner.innerHTML = html || ' ';
  line.append(inner);
  return line;
}

function makeLines(code: string): HTMLElement[] {
  const lines: HTMLElement[] = [];
  for (const html of highlightLines(code)) {
    lines.push(makeLine(html));
  }
  return lines;
}

/**
 * Groups changed lines into blocks that play one after another. Changes with
 * at most one unchanged line between them are one block, so a pass reads as a
 * few edits instead of many flickers.
 */
function groupBlocks(lines: HTMLElement[]): HTMLElement[][] {
  const blocks: HTMLElement[][] = [];
  let lastChange = -10;
  for (const [index, line] of lines.entries()) {
    if (line.dataset.kind === 'same') {
      continue;
    }
    const block = blocks.at(-1);
    if (block && index - lastChange <= 2) {
      for (let between = lastChange + 1; between < index; between += 1) {
        block.push(lines[between]);
      }
      block.push(line);
    } else {
      blocks.push([line]);
    }
    lastChange = index;
  }
  return blocks;
}

/** Starts the hero in `root`. Returns a function that stops it. */
export function playHero(root: HTMLElement): () => void {
  const parts: Parts = {
    picker: findPart(root, 'picker'),
    pause: findPart(root, 'pause'),
    stage: findPart(root, 'stage'),
    passes: findPart(root, 'passes'),
    code: findPart(root, 'code'),
    file: findPart(root, 'file'),
    count: findPart(root, 'count'),
    caption: findPart(root, 'caption'),
    templates: findPart(root, 'templates'),
    components: findPart(root, 'components'),
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

  function buildPasses(example: HeroExample): void {
    const thumb = parts.passes.querySelector(':scope > .seg-thumb');
    parts.passes.replaceChildren();
    parts.passes.removeAttribute('data-ready');
    if (thumb) {
      parts.passes.append(thumb);
    }
    const labels = listStates(example);
    // The passes are numbered; the source and Solid's output are not.
    for (const [index, label] of labels.entries()) {
      const item = document.createElement('li');
      item.className = 'hero-pass';
      if (index > 0 && index < labels.length - 1) {
        const number = document.createElement('span');
        number.className = 'hero-pass-number';
        number.textContent = String(index);
        item.append(number);
      }
      item.append(label);
      parts.passes.append(item);
    }
  }

  /** Marks step `at` in the step list. */
  function paintStep(at: number): void {
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

  /** Shows what Solid's output holds after step `at`. A step's counts show once its changes have played. */
  function paintCounts(example: HeroExample, at: number): void {
    const first = example.steps[0];
    const now = example.steps[Math.min(at, example.steps.length - 1)];
    parts.templates.textContent = `${String(first.templates)} → ${String(now.templates)}`;
    parts.components.textContent = `${String(first.components)} → ${String(now.components)}`;
  }

  function paintFile(text: string, isOutput: boolean): void {
    parts.file.textContent = isOutput ? 'Compiled by Solid · App.js' : 'App.tsx';
    parts.count.textContent = `${String(countLines(text))} lines`;
  }

  async function setCaption(text: string, mine: number): Promise<void> {
    parts.caption.toggleAttribute('data-out', true);
    await wait(180, mine);
    parts.caption.textContent = text;
    parts.caption.removeAttribute('data-out');
  }

  /** Scrolls the code window to `top`, and waits for the scroll to settle. */
  async function scrollCode(top: number, mine: number): Promise<void> {
    const target = Math.max(0, Math.min(top, parts.code.scrollHeight - parts.code.clientHeight));
    if (Math.abs(parts.code.scrollTop - target) < 4) {
      return;
    }
    parts.code.scrollTo({ top: target, behavior: 'smooth' });
    await wait(420, mine);
  }

  async function playChanges(before: string, after: string, mine: number): Promise<void> {
    const rows = diffLines(
      before.split('\n'),
      after.split('\n'),
      highlightLines(before),
      highlightLines(after),
    );
    const lines = rows.map((row) => makeLine(row.html, row.kind));
    parts.code.replaceChildren(...lines);
    await wait(300, mine);
    for (const block of groupBlocks(lines)) {
      const gone = block.filter((line) => line.dataset.kind === 'gone');
      const added = block.filter((line) => line.dataset.kind === 'new');
      await scrollCode(block[0].offsetTop - 80, mine);
      for (const line of gone) {
        line.dataset.tint = 'gone';
      }
      if (gone.length > 0) {
        await wait(700, mine);
        for (const line of gone) {
          line.toggleAttribute('data-hidden', true);
        }
        await wait(400, mine);
      }
      for (const line of added) {
        line.dataset.tint = 'new';
        line.removeAttribute('data-hidden');
      }
      if (added.length > 0) {
        await wait(600, mine);
      }
    }
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
    const source = example.steps[0];
    parts.code.replaceChildren(...makeLines(source.jsx));
    parts.code.scrollTop = 0;
    parts.caption.textContent = captionFor(example, source.label);
    paintStep(0);
    paintCounts(example, 0);
    paintFile(source.jsx, false);
    // Lay the new content out at its start position, then slide it in.
    parts.stage.getBoundingClientRect();
    parts.stage.removeAttribute('data-enter');
    await wait(3000, mine);
    for (let at = 1; at < example.steps.length; at += 1) {
      const step = example.steps[at];
      paintStep(at);
      await setCaption(captionFor(example, step.label), mine);
      await playChanges(example.steps[at - 1].jsx, step.jsx, mine);
      paintCounts(example, at);
      paintFile(step.jsx, false);
      await scrollCode(0, mine);
      await wait(1600, mine);
      for (const line of parts.code.querySelectorAll<HTMLElement>('.hero-line')) {
        delete line.dataset.tint;
      }
    }
    // Solid's JSX transform compiles the optimized JSX.
    paintStep(example.steps.length);
    await setCaption(captionFor(example, OUTPUT_LABEL), mine);
    parts.code.toggleAttribute('data-swap', true);
    await wait(240, mine);
    parts.code.replaceChildren(...makeLines(example.output));
    parts.code.scrollTop = 0;
    paintFile(example.output, true);
    parts.code.removeAttribute('data-swap');
    await wait(4200, mine);
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
    const label = pausedByReader ? 'Play the animation' : 'Pause the animation';
    parts.pause.dataset.state = pausedByReader ? 'on' : 'off';
    parts.pause.setAttribute('aria-label', label);
    parts.pause.title = label;
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
