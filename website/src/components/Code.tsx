import type { JSX } from '@solidjs/web';
import { createSignal } from 'solid-js';
import type { Language } from '../lib/highlight';
import { highlight } from '../lib/highlight';

export function Code(props: { code: string; lang?: Language; class?: string }): JSX.Element {
  return <div class={['code', props.class]} innerHTML={highlight(props.code, props.lang)} />;
}

export function CopyButton(props: { text: string; class?: string }): JSX.Element {
  const [copied, setCopied] = createSignal(false);

  function copy(): void {
    navigator.clipboard.writeText(props.text).then(
      () => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 1400);
      },
      () => {
        // Nothing to show when the clipboard is blocked.
      },
    );
  }

  return (
    <button
      type="button"
      class={['copy', props.class, { copied: copied() }]}
      onClick={copy}
      aria-label="Copy"
    >
      {copied() ? 'Copied' : 'Copy'}
    </button>
  );
}
