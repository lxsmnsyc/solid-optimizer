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
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import remapping from '@jridgewell/remapping';
import type * as Babel from '@babel/core';
import type { Plugin, ResolvedConfig, Rollup } from 'vite';
import { createFilter } from 'vite';
import type { Options as SolidPluginOptions } from 'vite-plugin-solid';
import solidPlugin from 'vite-plugin-solid';
import type { CompileOptions, CompileResult, ModuleConstants } from '../compile';
import { compile, readModuleConstants } from '../compile';
import type { ImportedConstants } from '../constants';
import type { Primitive } from '../value';
import {
  MARKER,
  MissingHelperError,
  addMarker,
  generatedImports,
  linkHelpers,
  readMarkers,
} from './runtime';

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
 * Helpers the JSX transform picks between for the same attribute. Inlining
 * can turn one form into the other: a style object that was a prop becomes a
 * literal, which the transform writes one property at a time. A module that
 * needs one keeps the other too.
 */
const RELATED_HELPERS: Readonly<Record<string, readonly string[]>> = {
  style: ['setStyleProperty'],
  setStyleProperty: ['style'],
};

function withRelated(helpers: readonly string[]): Set<string> {
  const result = new Set(helpers);
  for (const helper of helpers) {
    for (const related of RELATED_HELPERS[helper] ?? []) {
      result.add(related);
    }
  }
  return result;
}

/** Modules whose constants are read from disk: JavaScript and TypeScript sources. */
const SCRIPT_MODULE = /\.[mc]?[jt]sx?$/i;

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

  /** What each source file imports and the constants it exports, by path. */
  const moduleConstants = new Map<string, Promise<ModuleConstants | undefined>>();

  /**
   * The file an import resolves to, when its constants can be read from it:
   * a script in the project, not a virtual module, a module with a query,
   * or a dependency.
   */
  async function resolveSourceFile(
    context: Rollup.PluginContext,
    specifier: string,
    importer: string,
  ): Promise<string | undefined> {
    if (moduleSources.includes(specifier)) {
      return undefined;
    }
    const resolved = await context.resolve(specifier, importer);
    if (
      !resolved ||
      resolved.external ||
      resolved.id.startsWith('\0') ||
      resolved.id.includes('?') ||
      resolved.id.includes('/node_modules/') ||
      !SCRIPT_MODULE.test(resolved.id)
    ) {
      return undefined;
    }
    return resolved.id;
  }

  /**
   * The constants of the modules `code` imports, keyed by import specifier.
   *
   * Each module is read from disk, as written. A constant that another
   * plugin would rewrite, like a `define` replacement, is not a literal
   * there, so it does not fold. A module that imports constants itself
   * resolves them first, and a cycle leaves the modules in it without them.
   */
  async function importedConstants(
    context: Rollup.PluginContext,
    imports: readonly string[],
    importer: string,
    visiting: ReadonlySet<string>,
  ): Promise<ImportedConstants> {
    const entries = await Promise.all(
      imports.map(async (specifier) => {
        const file = await resolveSourceFile(context, specifier, importer);
        if (file === undefined || visiting.has(file)) {
          return undefined;
        }
        context.addWatchFile(file);
        const constants = await constantsOf(context, file, visiting);
        if (!constants || Object.keys(constants.exports).length === 0) {
          return undefined;
        }
        return [specifier, constants.exports] as const;
      }),
    );
    return Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [string, Record<string, Primitive>] => entry !== undefined,
      ),
    );
  }

  async function constantsOf(
    context: Rollup.PluginContext,
    file: string,
    visiting: ReadonlySet<string>,
  ): Promise<ModuleConstants | undefined> {
    let pending = moduleConstants.get(file);
    if (!pending) {
      pending = (async () => {
        let code: string;
        try {
          code = await readFile(file, 'utf8');
        } catch {
          return undefined;
        }
        try {
          const own = readModuleConstants(code, { filename: file });
          if (own.imports.length === 0) {
            return own;
          }
          const imported = await importedConstants(
            context,
            own.imports,
            file,
            new Set([...visiting, file]),
          );
          return readModuleConstants(code, { filename: file, importedConstants: imported });
        } catch (error) {
          // A module the parser rejects fails its own transform, with a better error.
          if (error instanceof SyntaxError) {
            return undefined;
          }
          throw error;
        }
      })();
      moduleConstants.set(file, pending);
    }
    return pending;
  }

  /**
   * The compile options for a module, with the constants of its imports.
   */
  async function moduleOptions(
    context: Rollup.PluginContext,
    code: string,
    id: string,
  ): Promise<CompileOptions> {
    const filename = stripQuery(id);
    if (optimizer.fold === false) {
      return { ...compileOptions, filename };
    }
    const { imports } = readModuleConstants(code, { filename });
    return {
      ...compileOptions,
      filename,
      importedConstants: await importedConstants(context, imports, filename, new Set([filename])),
    };
  }

  /**
   * Prepares a client module for chunk mode. It adds the helper marker
   * instead of lowering JSX. Vite strips the types afterwards.
   */
  async function keepJSX(
    context: Rollup.PluginContext,
    source: string,
    id: string,
  ): Promise<Rollup.TransformResult> {
    const filename = stripQuery(id);
    // Fold and inline memos before bundling. A branch that folds away takes
    // its imports and `lazy()` chunks out of the module graph, which the
    // chunk step can no longer do. Inlining waits for the chunk, where the
    // components it can reach are known.
    const local = compile(source, { ...(await moduleOptions(context, source, id)), inline: false });
    const code = local.code;
    const dryRun = lower(getCompiler(), code, filename, jsxOptions(false));
    const needed = generatedImports(dryRun.code, filename, moduleName);
    preserved.add(id);
    if (needed.length === 0) {
      return local.map ? { code, map: local.map.toString() } : null;
    }
    const marked = addMarker(code, filename, {
      moduleName,
      helpers: withRelated(needed),
      moduleSources,
      // The passes also recognize these primitives, which a chunk renames too.
      builtIns: new Set([...builtIns, 'createMemo']),
    });
    if (!marked) {
      return local.map ? { code, map: local.map.toString() } : null;
    }
    return {
      code: marked.code,
      map: combineMaps([local.map?.toString(), marked.map]),
    };
  }

  const originalTransform = main.transform;
  const originalHandler =
    typeof originalTransform === 'function' ? originalTransform : originalTransform?.handler;
  if (originalHandler) {
    main.transform = async function transform(code, id, transformOptions) {
      if (chunkMode() && isClient(this) && isJSXModule(id)) {
        return keepJSX(this, code, id);
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
    buildStart() {
      moduleConstants.clear();
    },
    watchChange() {
      moduleConstants.clear();
    },
    async transform(code, id) {
      if (!isBuild() && optimizer.dev !== true) {
        return null;
      }
      if ((chunkMode() && isClient(this)) || !isJSXModule(id)) {
        return null;
      }
      const result = compile(code, {
        ...(await moduleOptions(this, code, id)),
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
        let optimized: CompileResult | undefined = compile(runtime.code, {
          ...compileOptions,
          filename,
          constantVars: true,
          builtInAliases: runtime.builtInAliases,
        });
        let lowered = lower(getCompiler(), optimized.code, filename, jsxOptions(false));
        let linked: { code: string; map: string };
        try {
          linked = linkHelpers(lowered.code, filename, moduleName, runtime.helpers);
        } catch (error) {
          if (!(error instanceof MissingHelperError)) {
            throw error;
          }
          // Each module keeps the helpers its own JSX needs, and a merged
          // tree can need one none of them did. Without it, the chunk is
          // lowered as its modules were written. Chunk mode never hydrates,
          // so the chunks do not have to match anything else.
          this.warn(`${error.message} ${filename} is not optimized.`);
          optimized = undefined;
          lowered = lower(getCompiler(), runtime.code, filename, jsxOptions(false));
          linked = linkHelpers(lowered.code, filename, moduleName, runtime.helpers);
        }
        return {
          code: linked.code,
          map: combineMaps([runtime.map, optimized?.map?.toString(), lowered.map, linked.map]),
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
