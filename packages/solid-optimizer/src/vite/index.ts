/**
 * `solid-optimizer/vite`: `vite-plugin-solid` with the optimizer built in.
 *
 * It takes the same options as `vite-plugin-solid`, plus `optimizer`, and
 * returns the official plugin with the optimizer wired in. It runs in one of
 * two modes.
 *
 * - Chunk mode keeps JSX through bundling. Each chunk is optimized as a whole
 *   and then lowered by Solid's JSX transform, so a component inlines into
 *   any other component in the same chunk. It applies to client builds that
 *   do not hydrate.
 * - Module mode optimizes each module before the official plugin lowers it.
 *   It applies everywhere else. A server build and its client build chunk
 *   differently, and hydration needs both to render the same tree, so
 *   hydrating builds only optimize within a module.
 */
import { createRequire } from 'node:module';
import remapping from '@jridgewell/remapping';
import type * as Babel from '@babel/core';
import type { Plugin, ResolvedConfig, Rollup } from 'vite';
import { createFilter } from 'vite';
import type { Options as SolidPluginOptions } from 'vite-plugin-solid';
import solidPlugin from 'vite-plugin-solid';
import type { CompileOptions } from '../compile';
import { compile } from '../compile';
import { MARKER, addMarker, generatedImports, linkHelpers, readMarkers } from './runtime';

export interface OptimizerOptions extends Pick<
  CompileOptions,
  'fold' | 'inline' | 'memos' | 'maxPasses'
> {
  /**
   * Reduce Solid's reactive primitives to what they do on the server, in
   * server builds. See the `server` option of `compile`.
   *
   * @default true
   */
  server?: boolean;
  /**
   * Where the optimizer runs.
   *
   * - `auto` uses chunk mode for client builds that do not hydrate, and module mode otherwise.
   * - `module` optimizes each module on its own.
   *
   * @default 'auto'
   */
  mode?: 'auto' | 'module';
  /**
   * Also optimize while serving, in module mode.
   *
   * @default false
   */
  dev?: boolean;
}

export interface Options extends Partial<SolidPluginOptions> {
  /** Set to `false` to use `vite-plugin-solid` as it is. */
  optimizer?: OptimizerOptions | false;
}

/** The options `babel-preset-solid` takes. */
type JSXOptions = NonNullable<SolidPluginOptions['solid']> & {
  generate?: 'dom' | 'ssr' | 'universal';
  hydratable?: boolean;
};

interface Compiler {
  readonly babel: typeof Babel;
  readonly preset: Babel.PluginTarget;
}

const DEFAULT_MODULE_NAME = 'solid-js/web';

const DEFAULT_BUILT_INS = [
  'For',
  'Show',
  'Switch',
  'Match',
  'Suspense',
  'SuspenseList',
  'Portal',
  'Index',
  'Dynamic',
  'ErrorBoundary',
];

const JSX_MODULE = /\.[mc]?[jt]sx$/i;

/**
 * Every helper Solid's JSX transform can import for DOM output that does not
 * hydrate, which is the only output chunk mode lowers. An optimized chunk can
 * need a helper none of its modules needed, such as `setStyleProperty` once a
 * memo of a style object is inlined, so every module that keeps JSX imports
 * all of them.
 */
const DOM_HELPERS = [
  'addEventListener',
  'classList',
  'className',
  'createComponent',
  'delegateEvents',
  'effect',
  'getOwner',
  'insert',
  'memo',
  'mergeProps',
  'setAttribute',
  'setAttributeNS',
  'setBoolAttribute',
  'setProperty',
  'setStyleProperty',
  'spread',
  'style',
  'template',
  'use',
];

function loadCompiler(): Compiler {
  // Use the Babel and preset `vite-plugin-solid` uses, so both lower JSX the same way.
  const require = createRequire(import.meta.url);
  const pluginRequire = createRequire(require.resolve('vite-plugin-solid'));
  const presetRequire = createRequire(pluginRequire.resolve('babel-preset-solid'));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const babel = presetRequire('@babel/core') as typeof Babel;
  const preset: unknown = pluginRequire('babel-preset-solid');
  if (typeof preset !== 'function') {
    throw new TypeError('[solid-optimizer] babel-preset-solid did not load');
  }
  return { babel, preset };
}

/**
 * Lowers JSX with `babel-preset-solid`, as `vite-plugin-solid` does.
 */
function lower(
  compiler: Compiler,
  code: string,
  filename: string,
  options: JSXOptions,
): { code: string; map: string | undefined } {
  const result = compiler.babel.transformSync(code, {
    filename,
    sourceFileName: filename,
    presets: [[compiler.preset, options]],
    ast: false,
    sourceMaps: true,
    configFile: false,
    babelrc: false,
    parserOpts: {
      plugins: /\.[mc]?tsx$/i.test(filename) ? ['jsx', 'typescript'] : ['jsx'],
    },
  });
  if (!result?.code) {
    throw new Error(`[solid-optimizer] babel-preset-solid produced no code for ${filename}`);
  }
  return { code: result.code, map: result.map ? JSON.stringify(result.map) : undefined };
}

function stripQuery(id: string): string {
  return id.replace(/\?.*$/, '');
}

function combineMaps(maps: (string | null | undefined)[]): string | null {
  const present = maps.filter((map): map is string => typeof map === 'string');
  if (present.length === 0) {
    return null;
  }
  return remapping(present.reverse(), () => null).toString();
}

function isClient(context: { environment?: { config: { consumer: string } } }): boolean {
  return context.environment?.config.consumer === 'client';
}

export default function solidOptimizer(options: Options = {}): Plugin[] {
  const { optimizer: optimizerOption, ...solidOptions } = options;
  const main = solidPlugin(solidOptions);
  if (optimizerOption === false) {
    return [main];
  }
  const optimizer = optimizerOption ?? {};
  const moduleName = solidOptions.solid?.moduleName ?? DEFAULT_MODULE_NAME;
  const moduleSources = [...new Set(['solid-js', DEFAULT_MODULE_NAME, moduleName])];
  const builtIns = new Set(solidOptions.solid?.builtIns ?? DEFAULT_BUILT_INS);
  const compileOptions: CompileOptions = {
    fold: optimizer.fold,
    inline: optimizer.inline,
    memos: optimizer.memos,
    maxPasses: optimizer.maxPasses,
    builtIns: [...builtIns],
    moduleSources,
  };

  let config: ResolvedConfig | undefined;
  let compiler: Compiler | undefined;
  let filter: ((id: string) => boolean) | undefined;
  const getCompiler = (): Compiler => {
    compiler ??= loadCompiler();
    return compiler;
  };

  const isBuild = (): boolean => config?.command === 'build';

  /**
   * The JSX options the official plugin passes for a posture, so the
   * lowering here matches it. Mirrors the `transform` hook of `vite-plugin-solid`.
   */
  const jsxOptions = (isSsr: boolean): JSXOptions => {
    let posture: JSXOptions = { generate: 'dom', hydratable: false };
    if (solidOptions.ssr) {
      posture = { generate: isSsr ? 'ssr' : 'dom', hydratable: true };
    }
    return { ...posture, ...solidOptions.solid };
  };

  /**
   * Whether client builds keep JSX until chunks are rendered.
   */
  const chunkMode = (): boolean => {
    if (!isBuild() || (optimizer.mode ?? 'auto') !== 'auto') {
      return false;
    }
    // The user's Babel plugins have to see the modules, which chunk mode skips.
    if (solidOptions.babel) {
      return false;
    }
    const client = jsxOptions(false);
    return client.generate === 'dom' && client.hydratable !== true;
  };

  const isJSXModule = (id: string): boolean => {
    filter ??= createFilter(solidOptions.include, solidOptions.exclude);
    return filter(id) && JSX_MODULE.test(stripQuery(id));
  };

  /** Modules that keep their JSX, which the bundler must parse as JSX. */
  const preserved = new Set<string>();

  /**
   * Prepares a client module for chunk mode. It adds the helper marker
   * instead of lowering JSX. Vite strips the types afterwards.
   */
  function keepJSX(source: string, id: string): Rollup.TransformResult {
    const filename = stripQuery(id);
    const dryRun = lower(getCompiler(), source, filename, jsxOptions(false));
    const needed = generatedImports(dryRun.code, filename, moduleName);
    preserved.add(id);
    if (needed.length === 0) {
      return null;
    }
    const marked = addMarker(source, filename, {
      moduleName,
      helpers: new Set([...needed, ...DOM_HELPERS]),
      moduleSources,
      // The passes also recognize these primitives, which a chunk renames too.
      builtIns: new Set([...builtIns, 'createMemo']),
    });
    return marked ? { code: marked.code, map: marked.map } : null;
  }

  const originalTransform = main.transform;
  const originalHandler =
    typeof originalTransform === 'function' ? originalTransform : originalTransform?.handler;
  if (originalHandler) {
    main.transform = async function transform(code, id, transformOptions) {
      if (chunkMode() && isClient(this) && isJSXModule(id)) {
        return keepJSX(code, id);
      }
      return originalHandler.call(this, code, id, transformOptions);
    };
  }

  const modulePlugin: Plugin = {
    name: 'solid-optimizer:module',
    enforce: 'pre',
    configResolved(resolved) {
      config = resolved;
    },
    transform(code, id) {
      if (!isBuild() && optimizer.dev !== true) {
        return null;
      }
      if ((chunkMode() && isClient(this)) || !isJSXModule(id)) {
        return null;
      }
      const result = compile(code, {
        ...compileOptions,
        filename: stripQuery(id),
        // The server renders once, so its reactive primitives reduce to plain calls.
        server: optimizer.server !== false && !isClient(this),
      });
      if (!result.map) {
        return null;
      }
      return { code: result.code, map: result.map.toString() };
    },
  };

  const chunkPlugin: Plugin = {
    name: 'solid-optimizer:chunk',
    enforce: 'post',
    config(_, env) {
      if (env.command !== 'build') {
        return undefined;
      }
      // Kept JSX has to reach the bundler as JSX. Modules the official plugin
      // lowers have no JSX left, so this changes nothing for them.
      return {
        oxc: { jsx: 'preserve' },
        build: { rolldownOptions: { transform: { jsx: 'preserve' } } },
      };
    },
    renderChunk: {
      order: 'pre',
      handler(code, chunk) {
        if (!chunkMode() || !isClient(this) || !code.includes(MARKER)) {
          return null;
        }
        const filename = chunk.fileName;
        const runtime = readMarkers(code, filename);
        if (!runtime) {
          return null;
        }
        const optimized = compile(runtime.code, {
          ...compileOptions,
          filename,
          constantVars: true,
          builtInAliases: runtime.builtInAliases,
        });
        const lowered = lower(getCompiler(), optimized.code, filename, jsxOptions(false));
        const linked = linkHelpers(lowered.code, filename, moduleName, runtime.helpers);
        return {
          code: linked.code,
          map: combineMaps([runtime.map, optimized.map?.toString(), lowered.map, linked.map]),
        };
      },
    },
  };

  // Runs after `vite:oxc` strips types, which reports the module as plain
  // JavaScript, and before the built-in plugins that parse it again.
  const moduleTypePlugin: Plugin = {
    name: 'solid-optimizer:module-type',
    transform(code, id) {
      if (!preserved.has(id)) {
        return null;
      }
      return { code, moduleType: 'jsx' };
    },
  };

  return [modulePlugin, main, moduleTypePlugin, chunkPlugin];
}
