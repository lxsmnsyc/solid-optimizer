import type { PipelineOptions, VirtualFile } from './protocol';

/** What a REPL link holds, after `#repl=` in the URL. */
export interface Shared {
  files: VirtualFile[];
  options: PipelineOptions;
}

export const HASH_PREFIX = '#repl=';

export const DEFAULT_OPTIONS: PipelineOptions = {
  fold: true,
  inline: true,
  contexts: true,
  memos: true,
  generate: 'dom',
};

export function encodeShared(value: Shared): string {
  let latin1 = '';
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) {
    latin1 += String.fromCharCode(byte);
  }
  return btoa(latin1).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function isShared(value: unknown): value is Shared {
  return (
    typeof value === 'object' &&
    value !== null &&
    'files' in value &&
    Array.isArray(value.files) &&
    'options' in value &&
    typeof value.options === 'object'
  );
}

export function readShared(): Shared | undefined {
  if (!location.hash.startsWith(HASH_PREFIX)) {
    return undefined;
  }
  try {
    const latin1 = atob(
      location.hash.slice(HASH_PREFIX.length).replaceAll('-', '+').replaceAll('_', '/'),
    );
    const bytes = new Uint8Array(latin1.length);
    for (let i = 0; i < latin1.length; i++) {
      bytes[i] = latin1.charCodeAt(i);
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isShared(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The REPL page's URL with the files in it. */
export function replLink(files: VirtualFile[]): string {
  return `/repl/${HASH_PREFIX}${encodeShared({ files, options: DEFAULT_OPTIONS })}`;
}
