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
  const defines =
    environments.length > 0
      ? environments.map((environment) => environment.define ?? config.define ?? {})
      : [config.define ?? {}];
  const keys = new Set(defines.flatMap((define) => Object.keys(define)));
  for (const key of keys) {
    const values = defines.map((define) => defineValue(define[key]));
    const first = values.at(0);
    if (
      first !== undefined &&
      values.every((value) => value !== undefined && Object.is(value.value, first.value))
    ) {
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
