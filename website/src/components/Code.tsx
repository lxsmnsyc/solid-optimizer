import type { JSX } from '@solidjs/web';
import { createSignal } from 'solid-js';
import type { Language } from '../lib/highlight';
import { highlight } from '../lib/highlight';
import { Icon } from './Icon';

export function Code(props: { code: string; lang?: Language; class?: string }): JSX.Element {
  return <div class={['code', props.class]} innerHTML={highlight(props.code, props.lang)} />;
}

type CopyState = 'idle' | 'done' | 'failed';

const COPY_LABEL: Record<CopyState, string> = {
  idle: 'Copy',
  done: 'Copied',
  failed: 'Copy failed',
};

/** Banig's copy button: the icon swaps to a check, or a cross on failure, for 1.5s. */
export function CopyButton(props: { text: string; class?: string }): JSX.Element {
  const [state, setState] = createSignal<CopyState>('idle');
  let timer: ReturnType<typeof setTimeout> | undefined;

  function settle(next: CopyState): void {
    setState(next);
    // A second click restarts the timer.
    clearTimeout(timer);
    timer = setTimeout(() => {
      setState('idle');
    }, 1500);
  }

  function copy(): void {
    navigator.clipboard.writeText(props.text).then(
      () => {
        settle('done');
      },
      () => {
        settle('failed');
      },
    );
  }

  return (
    <button
      type="button"
      class={['code-copy', props.class]}
      data-state={state()}
      onClick={copy}
      aria-label={COPY_LABEL[state()]}
    >
      <span class="swap">
        <span data-off>
          <Icon name="copy" />
        </span>
        <span data-on>
          <Icon name="check" />
        </span>
        <span data-fail>
          <Icon name="circle-x" />
        </span>
      </span>
    </button>
  );
}
