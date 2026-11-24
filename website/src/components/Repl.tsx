import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { JSX } from '@solidjs/web';
import { Icon } from './Icon';
import { For, Show, createMemo, createSignal, onSettled } from 'solid-js';
import { createEditor, createFileState } from '../lib/editor';
import { highlight } from '../lib/highlight';
import type * as PipelineModule from '../repl/pipeline';
import { PRESETS } from '../repl/presets';
import { DEFAULT_OPTIONS, HASH_PREFIX, encodeShared, isShared, readShared } from '../repl/share';
import type {
  Lowered,
  PipelineFailure,
  PipelineOptions,
  PipelineSuccess,
  VirtualFile,
} from '../repl/protocol';

type Stage = 'bundle' | 'optimized' | 'output';
type Status = 'waiting' | 'loading' | 'running' | 'ready';

/** Where the REPL keeps the split between its panes. */
const SPLIT_KEY = 'repl-split';

/** Where the REPL keeps its example, options and edited files between visits. */
const STATE_KEY = 'repl-state';

/** How long a toast stays, and how long it takes to leave. */
const TOAST_MS = 5000;
const TOAST_LEAVE_MS = 220;

/** What the REPL keeps between visits. Files are kept only once they are edited. */
interface Saved {
  origin: string;
  options: PipelineOptions;
  files?: VirtualFile[];
}

/** The files, the tab and the example of the REPL, to put back on Undo. */
interface Snapshot {
  states: Map<string, EditorState>;
  names: string[];
  active: string;
  preset: string;
  origin: string;
}

const STAGES: { id: Stage; label: string }[] = [
  { id: 'bundle', label: 'Bundle' },
  { id: 'optimized', label: 'Optimize' },
  { id: 'output', label: 'Lower' },
];

const PASS_OPTIONS: { id: 'fold' | 'inline' | 'contexts' | 'memos'; label: string }[] = [
  { id: 'inline', label: 'inline' },
  { id: 'contexts', label: 'contexts' },
  { id: 'memos', label: 'memos' },
  { id: 'fold', label: 'fold' },
];

const FILE_NAME = /^[\w-]+(\/[\w-]+)*\.(tsx|ts|jsx|js)$/;

function getFileNames(files: VirtualFile[]): string[] {
  const names: string[] = [];
  for (const file of files) {
    names.push(file.name);
  }
  return names;
}

function findPreset(id: string): (typeof PRESETS)[number] | undefined {
  for (const item of PRESETS) {
    if (item.id === id) {
      return item;
    }
  }
  return undefined;
}

function readSaved(): Saved | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    if (
      typeof value !== 'object' ||
      value === null ||
      !('origin' in value) ||
      typeof value.origin !== 'string' ||
      !findPreset(value.origin) ||
      !('options' in value)
    ) {
      return undefined;
    }
    // The rest has the shape of a shared link. An example kept unedited has no files.
    const rest = { files: 'files' in value ? value.files : [], options: value.options };
    if (!isShared(rest)) {
      return undefined;
    }
    return {
      origin: value.origin,
      options: rest.options,
      files: rest.files.length > 0 ? rest.files : undefined,
    };
  } catch {
    // Storage is blocked or holds something else: the REPL starts at the first example.
    return undefined;
  }
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(2)} kB`;
}

function Metric(props: {
  label: string;
  before: number;
  after: number;
  format?: (value: number) => string;
}): JSX.Element {
  const format = (value: number): string => (props.format ? props.format(value) : String(value));
  const delta = (): number =>
    props.before === 0 ? 0 : Math.round(((props.after - props.before) / props.before) * 100);
  return (
    <Show when={props.before !== 0 || props.after !== 0}>
      <div class="metric">
        <span class="metric-label">{props.label}</span>
        <span class="metric-values">
          <span class="metric-before">{format(props.before)}</span>
          <span class="metric-arrow">
            <Icon name="arrow-right" />
          </span>
          <span class="metric-after">{format(props.after)}</span>
          <Show when={delta() !== 0}>
            <span class={['metric-delta', { worse: delta() > 0 }]}>
              {delta() > 0 ? '+' : ''}
              {delta()}%
            </span>
          </Show>
        </span>
      </div>
    </Show>
  );
}

export function Repl(): JSX.Element {
  // The server has no URL hash, so a shared link applies after hydration.
  // See `onSettled` below.
  const initialFiles = PRESETS[0].files;

  const [names, setNames] = createSignal<string[]>(getFileNames(initialFiles));
  const [active, setActive] = createSignal(initialFiles[0].name);
  const [preset, setPreset] = createSignal(PRESETS[0].id);
  const [options, setOptions] = createSignal<PipelineOptions>(DEFAULT_OPTIONS);
  const [stage, setStage] = createSignal<Stage>('output');
  const [baseline, setBaseline] = createSignal(false);
  const [status, setStatus] = createSignal<Status>('waiting');
  const [result, setResult] = createSignal<PipelineSuccess>();
  const [failure, setFailure] = createSignal<PipelineFailure>();
  const [renaming, setRenaming] = createSignal<string>();
  const [linkCopied, setLinkCopied] = createSignal(false);
  // The example the files came from, which Reset brings back.
  const [origin, setOrigin] = createSignal(PRESETS[0].id);
  const [toast, setToast] = createSignal<{ text: string; undo: () => void }>();
  const [toastOpen, setToastOpen] = createSignal(false);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // Each file keeps its own editor state, so switching tabs keeps its undo history.
  const states = new Map<string, EditorState>();
  let view: EditorView | undefined;
  let pipeline: Promise<typeof PipelineModule> | undefined;
  let requestId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onChange = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      setPreset('');
      schedule(250);
    }
  });

  function loadFiles(files: VirtualFile[]): void {
    states.clear();
    for (const file of files) {
      states.set(file.name, createFileState(file.code, [onChange]));
    }
  }
  loadFiles(initialFiles);

  function readFiles(): VirtualFile[] {
    if (view) {
      states.set(active(), view.state);
    }
    const files: VirtualFile[] = [];
    for (const name of names()) {
      const state = states.get(name);
      if (state) {
        files.push({ name, code: state.doc.toString() });
      }
    }
    return files;
  }

  // Signal writes settle after the current task, so every run is deferred.
  function schedule(delay = 0): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
      save();
      startRun();
    }, delay);
  }

  /** Keeps the example and the options, and the files once they are edited, for the next visit. */
  function save(): void {
    const files = readFiles();
    const edited = preset() === '';
    // A shared link in the address bar that no longer matches the files would bring old files back on reload.
    if (
      location.hash.startsWith(HASH_PREFIX) &&
      location.hash.slice(HASH_PREFIX.length) !== encodeShared({ files, options: options() })
    ) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
    const saved: Saved = { origin: origin(), options: options() };
    if (edited) {
      saved.files = files;
    }
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(saved));
    } catch {
      // Storage is blocked or full: the files stay on this page only.
    }
  }

  async function run(): Promise<void> {
    if (!pipeline) {
      return;
    }
    const id = ++requestId;
    setStatus(result() || failure() ? 'running' : 'loading');
    const { runPipeline } = await pipeline;
    const response = await runPipeline({ id, files: readFiles(), options: options() });
    if (response.id !== requestId) {
      return;
    }
    setStatus('ready');
    if (response.ok) {
      setResult(response);
      setFailure(undefined);
    } else {
      setFailure(response);
    }
  }

  // A pipeline that fails to load reports it in the output pane.
  function startRun(): void {
    run().catch((error: unknown) => {
      pipeline = undefined;
      setStatus('ready');
      setFailure({
        id: requestId,
        ok: false,
        stage: 'load',
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  function start(): void {
    pipeline ??= import('../repl/pipeline');
    startRun();
  }

  function openFile(name: string): void {
    if (!view || name === active()) {
      return;
    }
    states.set(active(), view.state);
    const next = states.get(name);
    if (next) {
      view.setState(next);
      setActive(name);
    }
  }

  /** Loads an example. Edits it replaces come back with Undo. */
  function loadPreset(id: string): void {
    const found = findPreset(id);
    if (!found) {
      return;
    }
    const before = preset() === '' ? takeSnapshot() : undefined;
    showFiles(found.files, id);
    if (before) {
      showToast(id === before.origin ? 'Example reset' : 'Edits replaced', () => {
        restore(before);
      });
    }
  }

  function takeSnapshot(): Snapshot {
    if (view) {
      states.set(active(), view.state);
    }
    return {
      states: new Map(states),
      names: names(),
      active: active(),
      preset: preset(),
      origin: origin(),
    };
  }

  // Each file gets its editor state back, with its undo history.
  function restore(snapshot: Snapshot): void {
    states.clear();
    for (const [name, state] of snapshot.states) {
      states.set(name, state);
    }
    setNames(snapshot.names);
    setActive(snapshot.active);
    setPreset(snapshot.preset);
    setOrigin(snapshot.origin);
    const state = states.get(snapshot.active);
    if (view && state) {
      view.setState(state);
    }
    schedule();
  }

  /** Shows one toast with Undo. A new one replaces the old. */
  function showToast(text: string, undo: () => void): void {
    clearTimeout(toastTimer);
    setToast({ text, undo });
    // Two frames, so the toast is drawn closed before it opens.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setToastOpen(true);
      });
    });
    armToast();
  }

  function armToast(): void {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, TOAST_MS);
  }

  function pauseToast(): void {
    clearTimeout(toastTimer);
  }

  function hideToast(): void {
    clearTimeout(toastTimer);
    setToastOpen(false);
    toastTimer = setTimeout(() => {
      setToast(undefined);
    }, TOAST_LEAVE_MS);
  }

  /** Replaces every file, and marks the preset they come from, or none. */
  function showFiles(files: VirtualFile[], presetId: string): void {
    loadFiles(files);
    const first = files[0].name;
    setNames(getFileNames(files));
    setActive(first);
    setPreset(presetId);
    if (presetId !== '') {
      setOrigin(presetId);
    }
    const state = states.get(first);
    if (view && state) {
      view.setState(state);
    }
    schedule();
  }

  function addFile(): void {
    const taken = new Set(names());
    let index = 1;
    while (taken.has(`Component${index}.tsx`)) {
      index++;
    }
    const name = `Component${index}.tsx`;
    if (view) {
      states.set(active(), view.state);
    }
    const state = createFileState(`export function Component${index}() {\n  return <div />;\n}\n`, [
      onChange,
    ]);
    states.set(name, state);
    setNames([...names(), name]);
    setActive(name);
    view?.setState(state);
    setRenaming(name);
  }

  function removeFile(name: string): void {
    const list = names();
    if (list.length === 1) {
      return;
    }
    const next: string[] = [];
    for (const item of list) {
      if (item !== name) {
        next.push(item);
      }
    }
    if (view && name !== active()) {
      states.set(active(), view.state);
    }
    states.delete(name);
    setNames(next);
    if (name === active()) {
      const state = states.get(next[0]);
      setActive(next[0]);
      if (view && state) {
        view.setState(state);
      }
    }
    setPreset('');
    schedule();
  }

  function renameFile(from: string, input: string): void {
    setRenaming(undefined);
    let to = input.trim();
    if (to !== '' && !/\.[jt]sx?$/.test(to)) {
      to += '.tsx';
    }
    if (to === from || !FILE_NAME.test(to) || names().includes(to)) {
      return;
    }
    if (view) {
      states.set(active(), view.state);
    }
    const state = states.get(from);
    if (!state) {
      return;
    }
    states.delete(from);
    states.set(to, state);
    const next: string[] = [];
    for (const item of names()) {
      next.push(item === from ? to : item);
    }
    setNames(next);
    if (active() === from) {
      setActive(to);
    }
    setPreset('');
    schedule();
  }

  function setOption(id: keyof PipelineOptions, value: boolean | string): void {
    setOptions({ ...options(), [id]: value });
    schedule();
  }

  function share(): void {
    const url = `${location.origin}${location.pathname}${HASH_PREFIX}${encodeShared({
      files: readFiles(),
      options: options(),
    })}`;
    history.replaceState(null, '', url);
    navigator.clipboard.writeText(url).then(
      () => {
        setLinkCopied(true);
        setTimeout(() => {
          setLinkCopied(false);
        }, 1400);
      },
      () => {
        // The link is still in the address bar when the clipboard is blocked.
      },
    );
  }

  const shown = createMemo((): { code: string; lowered?: Lowered } | undefined => {
    const current = result();
    if (!current) {
      return undefined;
    }
    switch (stage()) {
      case 'bundle':
        return { code: current.bundle };
      case 'optimized':
        return { code: current.optimized };
      default: {
        const lowered = baseline() ? current.baseline : current.output;
        return { code: lowered.code, lowered };
      }
    }
  });

  const shownHTML = createMemo(() => {
    const current = shown();
    return current ? highlight(current.code) : '';
  });

  let root: HTMLDivElement | undefined;
  let panes: HTMLDivElement | undefined;

  // The editor pane's share of the width, in percent. Banig's Playground keeps it between 20 and 80.
  const [split, setSplit] = createSignal(50);
  const [dragging, setDragging] = createSignal(false);

  function resize(percent: number): void {
    const clamped = Math.min(80, Math.max(20, Math.round(percent)));
    setSplit(clamped);
    try {
      localStorage.setItem(SPLIT_KEY, String(clamped));
    } catch {
      // The split still holds on this page.
    }
  }

  function dragSplit(event: PointerEvent): void {
    if (!panes) {
      return;
    }
    const box = panes.getBoundingClientRect();
    // Panes stack below 48rem, where the handle moves along the height.
    const stacked = getComputedStyle(panes).gridTemplateRows.split(' ').length > 1;
    const percent = stacked
      ? ((event.clientY - box.top) / box.height) * 100
      : ((event.clientX - box.left) / box.width) * 100;
    resize(percent);
  }

  function startDrag(event: PointerEvent): void {
    if (!(event.currentTarget instanceof HTMLElement)) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function moveSplitByKey(event: KeyboardEvent): void {
    const width = panes?.getBoundingClientRect().width ?? 1000;
    // Arrow keys move the handle 16px.
    const step = (16 / width) * 100;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      resize(split() - step);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      resize(split() + step);
    }
  }

  onSettled(() => {
    try {
      const saved = Number(localStorage.getItem(SPLIT_KEY));
      if (saved >= 20 && saved <= 80) {
        setSplit(saved);
      }
    } catch {
      // Storage is blocked: the panes start even.
    }
  });

  onSettled(() => {
    // A shared link wins over what the last visit left.
    const shared = readShared();
    const saved = shared ? undefined : readSaved();
    if (shared) {
      setOptions({ ...DEFAULT_OPTIONS, ...shared.options });
      showFiles(shared.files, '');
    } else if (saved) {
      setOptions({ ...DEFAULT_OPTIONS, ...saved.options });
      const example = findPreset(saved.origin);
      if (saved.files) {
        setOrigin(saved.origin);
        showFiles(saved.files, '');
      } else if (example) {
        showFiles(example.files, saved.origin);
      }
    }
    // The compilers are several megabytes of WebAssembly, so they load once
    // the REPL comes near the screen.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            observer.disconnect();
            start();
          }
        }
      },
      { rootMargin: '600px' },
    );
    if (root) {
      observer.observe(root);
    }
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(toastTimer);
      view?.destroy();
    };
  });

  return (
    <div
      class="repl"
      data-dragging={dragging() ? '' : undefined}
      ref={(element) => {
        root = element;
      }}
    >
      <div class="repl-toolbar">
        <div class="segmented" aria-label="Examples">
          <For each={PRESETS}>
            {(item) => (
              <button
                type="button"
                aria-pressed={preset() === item.id ? 'true' : 'false'}
                class={['segment', { selected: preset() === item.id }]}
                onClick={() => {
                  loadPreset(item.id);
                }}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
        <div class="repl-options">
          <For each={PASS_OPTIONS}>
            {(item) => (
              <label class={['toggle', { on: options()[item.id] }]}>
                <input
                  type="checkbox"
                  checked={options()[item.id]}
                  onChange={(event) => {
                    setOption(item.id, event.currentTarget.checked);
                  }}
                />
                <span class="toggle-dot" />
                {item.label}
              </label>
            )}
          </For>
          <div class="segmented small" aria-label="Output">
            <For each={['dom', 'ssr'] as const}>
              {(item) => (
                <button
                  type="button"
                  aria-pressed={options().generate === item ? 'true' : 'false'}
                  class={['segment', { selected: options().generate === item }]}
                  onClick={() => {
                    setOption('generate', item);
                  }}
                >
                  {item}
                </button>
              )}
            </For>
          </div>
          <span class="repl-status" role="status" data-tone={failure() ? 'danger' : undefined}>
            <Show
              when={failure()}
              fallback={
                <Show
                  when={status() === 'ready' && result()}
                  fallback={
                    <>
                      <Icon name="loader" class="spin" />
                      {status() === 'running' ? 'Compiling' : 'Loading the compilers'}
                    </>
                  }
                >
                  {(current) => <>Compiled in {current().ms.toFixed(1)} ms</>}
                </Show>
              }
            >
              {(current) => (
                <>
                  <Icon name="circle-x" />
                  {current().stage} failed
                </>
              )}
            </Show>
          </span>
          <button
            type="button"
            class="icon-button"
            data-size="sm"
            aria-label="Reset the example"
            title="Reset the example"
            disabled={preset() !== ''}
            onClick={() => {
              loadPreset(origin());
            }}
          >
            <Icon name="rotate-ccw" />
          </button>
          <button type="button" class="ghost-button" onClick={share}>
            {linkCopied() ? 'Link copied' : 'Share'}
          </button>
        </div>
      </div>

      <div
        class="repl-panes"
        style={{ '--split-a': `${String(split())}fr`, '--split-b': `${String(100 - split())}fr` }}
        ref={(element) => {
          panes = element;
        }}
      >
        <section class="pane" aria-label="Files">
          <div class="tabs">
            <For each={names()}>
              {(name, index) => (
                <div class={['tab', { selected: active() === name }]}>
                  <Show
                    when={renaming() === name}
                    fallback={
                      <button
                        type="button"
                        class="tab-name"
                        onClick={() => {
                          openFile(name);
                        }}
                        onDblClick={() => {
                          setRenaming(name);
                        }}
                        title={
                          index() === 0
                            ? 'Entry · double-click to rename'
                            : 'Double-click to rename'
                        }
                      >
                        <Show when={index() === 0}>
                          <span class="entry-dot" />
                        </Show>
                        {name}
                      </button>
                    }
                  >
                    <input
                      class="tab-input"
                      value={name}
                      aria-label="File name"
                      ref={(element) => {
                        queueMicrotask(() => {
                          element.focus();
                          element.setSelectionRange(0, element.value.lastIndexOf('.'));
                        });
                      }}
                      onBlur={(event) => {
                        renameFile(name, event.currentTarget.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur();
                        } else if (event.key === 'Escape') {
                          setRenaming(undefined);
                        }
                      }}
                    />
                  </Show>
                  <Show when={names().length > 1}>
                    <button
                      type="button"
                      class="tab-close"
                      aria-label={`Delete ${name}`}
                      onClick={() => {
                        removeFile(name);
                      }}
                    >
                      <Icon name="x" />
                    </button>
                  </Show>
                </div>
              )}
            </For>
            <button type="button" class="tab-add" aria-label="Add a file" onClick={addFile}>
              <Icon name="plus" />
            </button>
          </div>
          <div
            class="editor"
            ref={(element) => {
              const state = states.get(active());
              if (state) {
                view = createEditor(element, state);
              }
            }}
          />
        </section>

        <div
          class="repl-split"
          role="separator"
          tabindex="0"
          aria-label="Resize the panes"
          aria-orientation="vertical"
          aria-valuemin={20}
          aria-valuemax={80}
          aria-valuenow={split()}
          data-dragging={dragging() ? '' : undefined}
          onPointerDown={startDrag}
          onPointerMove={(event) => {
            if (dragging()) {
              dragSplit(event);
            }
          }}
          onPointerUp={() => {
            setDragging(false);
          }}
          onPointerCancel={() => {
            setDragging(false);
          }}
          onKeyDown={moveSplitByKey}
        />

        <section class="pane" aria-label="Output" data-tone={failure() ? 'danger' : undefined}>
          <div class="tabs stages">
            <For each={STAGES}>
              {(item, index) => (
                <>
                  <Show when={index() > 0}>
                    <span class="stage-arrow" aria-hidden="true" />
                  </Show>
                  <button
                    type="button"
                    class={['stage', { selected: stage() === item.id }]}
                    onClick={() => {
                      setStage(item.id);
                    }}
                  >
                    <span class="stage-index">{index() + 1}</span>
                    {item.label}
                  </button>
                </>
              )}
            </For>
            <Show when={stage() === 'output'}>
              <label class={['toggle', 'baseline-toggle', { on: !baseline() }]}>
                <input
                  type="checkbox"
                  checked={!baseline()}
                  onChange={(event) => {
                    setBaseline(!event.currentTarget.checked);
                  }}
                />
                <span class="toggle-dot" />
                optimizer
              </label>
            </Show>
          </div>
          <div class="output">
            <Show when={failure()}>
              {(current) => (
                <div class="output-error">
                  <span class="error-stage">{current().stage} failed</span>
                  <pre>{current().message}</pre>
                </div>
              )}
            </Show>
            <Show
              when={shown()}
              fallback={
                <div class="output-empty">
                  <Icon name="loader" class="spin" />
                  {status() === 'waiting' ? 'Waiting' : 'Loading the compilers (WebAssembly)'}
                </div>
              }
            >
              <div
                class={['output-code', { stale: !!failure() || status() === 'running' }]}
                innerHTML={shownHTML()}
              />
            </Show>
          </div>
          <Show when={result()}>
            {(current) => (
              <footer class="metrics">
                <Metric
                  label="templates"
                  before={current().baseline.templates}
                  after={current().output.templates}
                />
                <Metric
                  label="component calls"
                  before={current().baseline.components}
                  after={current().output.components}
                />
                <Metric
                  label="gzip"
                  before={current().baseline.gzip}
                  after={current().output.gzip}
                  format={formatBytes}
                />
                <span class="metric-time">{current().ms.toFixed(1)} ms</span>
              </footer>
            )}
          </Show>
          <Show when={result()?.skipped.length}>
            <details class="skipped">
              <summary>Left alone ({result()?.skipped.length})</summary>
              <ul>
                <For each={result()?.skipped ?? []}>
                  {(skip) => (
                    <li>
                      <code>{skip.name}</code>
                      <span>
                        {skip.pass} · {skip.reason}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </details>
          </Show>
        </section>
      </div>

      <div class="repl-toasts">
        <Show when={toast()}>
          {(current) => (
            <div
              class="toast"
              role="status"
              data-state={toastOpen() ? 'open' : 'closed'}
              onPointerEnter={pauseToast}
              onPointerLeave={armToast}
              onFocusIn={pauseToast}
              onFocusOut={armToast}
            >
              <Icon name="rotate-ccw" />
              <span class="toast-text">{current().text}</span>
              <button
                type="button"
                class="button"
                data-variant="primary"
                onClick={() => {
                  current().undo();
                  hideToast();
                }}
              >
                <Icon name="undo-2" />
                Undo
              </button>
              <button type="button" class="icon-button" aria-label="Dismiss" onClick={hideToast}>
                <Icon name="x" />
              </button>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
