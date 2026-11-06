/**
 * The global constants every build environment shares, from Vite's `define`
 * and `import.meta.env`.
 */
import type { ResolvedConfig } from 'vite';
import type { Primitive } from '../value';

/**
 * The `define` entries and `import.meta.env` values that are the same in
 * every build environment, as global constants. A value that differs, like
 * `import.meta.env.SSR`, could make the server and client builds fold, and
 * then inline, differently, so their hydration keys would not match.
 */
export function sharedGlobals(
  config: Pick<ResolvedConfig, 'env' | 'define' | 'environments'>,
): Record<string, Primitive> {
  const globals: Record<string, Primitive> = {};
  for (const [key, value] of Object.entries(config.env)) {
    if (
      key !== 'SSR' &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    ) {
      globals[`import.meta.env.${key}`] = value;
    }
  }
  const environments = Object.values(config.environments);
  const defines: Record<string, unknown>[] = [];
  if (environments.length > 0) {
    for (const environment of environments) {
      defines.push(environment.define ?? config.define ?? {});
    }
  } else {
    defines.push(config.define ?? {});
  }
  const keys = new Set<string>();
  for (const define of defines) {
    for (const key of Object.keys(define)) {
      keys.add(key);
    }
  }
  for (const key of keys) {
    // Every environment must define the key as the same value.
    let first: { value: Primitive } | undefined;
    let same = true;
    for (const define of defines) {
      const value = defineValue(define[key]);
      first ??= value;
      if (value === undefined || !Object.is(value.value, first?.value)) {
        same = false;
        break;
      }
    }
    if (first !== undefined && same) {
      globals[key] = first.value;
    }
  }
  return globals;
}

/**
 * The primitive a `define` entry replaces its key with. A string is code,
 * so only one that is a JSON literal counts.
 */
function defineValue(value: unknown): { value: Primitive } | undefined {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (
    parsed === null ||
    typeof parsed === 'string' ||
    typeof parsed === 'number' ||
    typeof parsed === 'boolean'
  ) {
    return { value: parsed };
  }
  return undefined;
}
