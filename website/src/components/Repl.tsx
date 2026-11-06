import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { JSX } from '@solidjs/web';
import { For, Show, createMemo, createSignal, onSettled } from 'solid-js';
import { createEditor, createFileState } from '../lib/editor';
import { highlight } from '../lib/highlight';
import type * as PipelineModule from '../repl/pipeline';
import { PRESETS } from '../repl/presets';
import { DEFAULT_OPTIONS, HASH_PREFIX, encodeShared, readShared } from '../repl/share';
import type {
  Lowered,
  PipelineFailure,
  PipelineOptions,
  PipelineSuccess,
  VirtualFile,
} from '../repl/protocol';

type Stage = 'bundle' | 'optimized' | 'output';
type Status = 'waiting' | 'loading' | 'running' | 'ready';

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
          <span class="metric-arrow">→</span>
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
  const shared = readShared();
  const initialFiles = shared?.files ?? PRESETS[0].files;

  const [names, setNames] = createSignal<string[]>(getFileNames(initialFiles));
  const [active, setActive] = createSignal(initialFiles[0].name);
  const [preset, setPreset] = createSignal(shared ? '' : PRESETS[0].id);
  const [options, setOptions] = createSignal<PipelineOptions>({
    ...DEFAULT_OPTIONS,
    ...shared?.options,
  });
  const [stage, setStage] = createSignal<Stage>('output');
  const [baseline, setBaseline] = createSignal(false);
  const [status, setStatus] = createSignal<Status>('waiting');
  const [result, setResult] = createSignal<PipelineSuccess>();
  const [failure, setFailure] = createSignal<PipelineFailure>();
  const [renaming, setRenaming] = createSignal<string>();
  const [linkCopied, setLinkCopied] = createSignal(false);

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
    timer = setTimeout(startRun, delay);
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

  function loadPreset(id: string): void {
    const found = findPreset(id);
    if (!found) {
      return;
    }
    loadFiles(found.files);
    const first = found.files[0].name;
    setNames(getFileNames(found.files));
    setActive(first);
    setPreset(id);
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

  onSettled(() => {
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
      view?.destroy();
    };
  });

  return (
    <div
      class="repl"
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
          <button type="button" class="ghost-button" onClick={share}>
            {linkCopied() ? 'Link copied' : 'Share'}
          </button>
        </div>
      </div>

      <div class="repl-panes">
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
                      ×
                    </button>
                  </Show>
                </div>
              )}
            </For>
            <button type="button" class="tab-add" aria-label="Add a file" onClick={addFile}>
              +
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

        <section class="pane" aria-label="Output">
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
                  <span class="spinner" />
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
    </div>
  );
}
