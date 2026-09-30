/**
 * `solid-optimizer/vite`: `@solidjs/vite-plugin` with the optimizer built in.
 *
 * It takes the same options as `@solidjs/vite-plugin`, plus `optimizer`, and
 * returns the official plugins with the optimizer wired in. It runs in one of
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
import path from 'node:path';
import remapping from '@jridgewell/remapping';
import type * as SolidCompiler from '@solidjs/compiler';
import type { Options as SolidPluginOptions } from '@solidjs/vite-plugin';
import solidPlugin from '@solidjs/vite-plugin';
import type { Plugin, ResolvedConfig, Rollup } from 'vite';
import { createFilter } from 'vite';
import type { CompileOptions, CompileResult, ModuleConstants } from '../compile';
import { compile, readModuleConstants } from '../compile';
import type { ImportedConstants } from '../constants';
import {
  MARKER,
  MissingHelperError,
  addMarker,
  generatedImports,
  linkHelpers,
  readMarkers,
  repairJSXSequences,
} from './runtime';

export interface OptimizerOptions extends Pick<
  CompileOptions,
  'fold' | 'inline' | 'memos' | 'maxPasses'
> {
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
  /** Set to `false` to use `@solidjs/vite-plugin` as it is. */
  optimizer?: OptimizerOptions | false;
}

type Compiler = typeof SolidCompiler;
type JSXOptions = SolidCompiler.TransformOptions;

const DEFAULT_MODULE_NAME = '@solidjs/web';

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

const LAZY_PLACEHOLDER = /"__SOLID_LAZY_MODULE__:([^"]+)"/g;

function loadCompiler(): Compiler {
  // Use the compiler `@solidjs/vite-plugin` uses, so both lower JSX the same way.
  const require = createRequire(import.meta.url);
  const pluginRequire = createRequire(require.resolve('@solidjs/vite-plugin'));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return pluginRequire('@solidjs/compiler') as Compiler;
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
  const plugins = solidPlugin(solidOptions);
  if (optimizerOption === false) {
    return plugins;
  }
  const optimizer = optimizerOption ?? {};
  const moduleName = solidOptions.solid?.moduleName ?? DEFAULT_MODULE_NAME;
  const moduleSources = [...new Set(['solid-js', DEFAULT_MODULE_NAME, moduleName])];
  const builtIns = new Set(
    solidOptions.solid?.builtIns ?? [
      'For',
      'Show',
      'Switch',
      'Match',
      'Loading',
      'Reveal',
      'Portal',
      'Repeat',
      'Dynamic',
      'Errored',
    ],
  );
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
   * lowering here matches it. Mirrors `getSolidOptions` in `@solidjs/vite-plugin`.
   */
  const jsxOptions = (isSsr: boolean): JSXOptions => {
    let posture: Pick<JSXOptions, 'generate' | 'hydratable'>;
    if (solidOptions.start && !solidOptions.ssr) {
      posture = { generate: isSsr ? 'ssr' : 'dom', hydratable: false };
    } else if (solidOptions.ssr) {
      posture = { generate: isSsr ? 'ssr' : 'dom', hydratable: true };
    } else {
      posture = { generate: 'dom', hydratable: false };
    }
    const dev = solidOptions.dev === true || (solidOptions.dev !== false && !isBuild());
    const names = dev || solidOptions.observe === true;
    const { sourceNames, ...rest } = solidOptions.solid ?? {};
    let resolvedNames: JSXOptions['sourceNames'] = false;
    if (typeof sourceNames === 'boolean') {
      resolvedNames = sourceNames;
    } else if (sourceNames !== undefined || names) {
      const components = sourceNames?.components ?? names;
      const bindings = sourceNames?.bindings ?? names;
      resolvedNames = components || bindings ? { components, bindings } : false;
    }
    return { ...posture, dev, sourceNames: resolvedNames, ...rest };
  };

  /**
   * Whether client builds keep JSX until chunks are rendered.
   */
  const chunkMode = (): boolean => {
    if (!isBuild() || (optimizer.mode ?? 'auto') !== 'auto') {
      return false;
    }
    // A Babel pass or backend has to see the modules, which chunk mode skips.
    if (solidOptions.babel || solidOptions.compiler === 'babel') {
      return false;
    }
    const client = jsxOptions(false);
    return client.generate === 'dom' && client.hydratable !== true;
  };

  const isJSXModule = (id: string): boolean => {
    filter ??= createFilter(solidOptions.include, solidOptions.exclude, {
      resolve: config?.root,
    });
    return filter(id) && JSX_MODULE.test(stripQuery(id));
  };

  /** Modules that keep their JSX, which the bundler must parse as JSX. */
  const preserved = new Set<string>();

  /** What each module imports and the constants it exports, by module id. */
  const moduleConstants = new Map<string, Promise<ModuleConstants | undefined>>();

  /**
   * The module an import resolves to, when its constants can be read.
   *
   * A module with JSX is skipped. This plugin's transform may be waiting for
   * it, and it may be waiting for this one, so loading it could deadlock.
   * Dependencies are skipped to keep the build fast.
   */
  async function resolveConstantModule(
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
      resolved.id.includes('/node_modules/') ||
      isJSXModule(resolved.id)
    ) {
      return undefined;
    }
    return resolved.id;
  }

  /**
   * The constants of the modules `code` imports, keyed by import specifier.
   *
   * Each module is read as the bundler loads it, after every plugin has
   * transformed it, so a plugin that replaces or rewrites a module is seen.
   * A module that imports constants itself resolves them first, and a cycle
   * leaves the modules in it without them.
   */
  async function importedConstants(
    context: Rollup.PluginContext,
    imports: readonly string[],
    importer: string,
    visiting: ReadonlySet<string>,
  ): Promise<ImportedConstants> {
    const entries = await Promise.all(
      imports.map(async (specifier) => {
        const id = await resolveConstantModule(context, specifier, importer);
        if (id === undefined || visiting.has(id)) {
          return undefined;
        }
        const constants = await constantsOf(context, id, visiting);
        if (!constants || Object.keys(constants.exports).length === 0) {
          return undefined;
        }
        return [specifier, constants.exports] as const;
      }),
    );
    return Object.fromEntries(entries.filter((entry) => entry !== undefined));
  }

  async function constantsOf(
    context: Rollup.PluginContext,
    id: string,
    visiting: ReadonlySet<string>,
  ): Promise<ModuleConstants | undefined> {
    let pending = moduleConstants.get(id);
    if (!pending) {
      pending = (async () => {
        const { code } = await context.load({ id });
        if (code === null) {
          return undefined;
        }
        // Loaded code is JavaScript, whatever the module was written in.
        const filename = `${stripQuery(id)}.js`;
        try {
          const own = readModuleConstants(code, { filename });
          if (own.imports.length === 0) {
            return own;
          }
          const imported = await importedConstants(
            context,
            own.imports,
            id,
            new Set([...visiting, id]),
          );
          return readModuleConstants(code, { filename, importedConstants: imported });
        } catch (error) {
          // A module the parser rejects fails its own transform, with a better error.
          if (error instanceof SyntaxError) {
            return undefined;
          }
          throw error;
        }
      })();
      moduleConstants.set(id, pending);
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
    // The dev server cannot give back the code of a loaded module.
    if (optimizer.fold === false || !isBuild()) {
      return { ...compileOptions, filename };
    }
    const { imports } = readModuleConstants(code, { filename });
    return {
      ...compileOptions,
      filename,
      importedConstants: await importedConstants(context, imports, filename, new Set([filename])),
    };
  }

  async function resolveLazyModuleUrls(
    context: Rollup.TransformPluginContext,
    code: string,
    importer: string,
  ): Promise<string> {
    const root = config?.root ?? process.cwd();
    let result = code;
    for (const match of code.matchAll(LAZY_PLACEHOLDER)) {
      const specifier = match.at(1);
      if (specifier === undefined) {
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop
      const resolved = await context.resolve(specifier, importer);
      if (resolved) {
        const queryIndex = resolved.id.indexOf('?');
        const file = queryIndex === -1 ? resolved.id : resolved.id.slice(0, queryIndex);
        const query = queryIndex === -1 ? '' : resolved.id.slice(queryIndex);
        const relative = path.relative(root, file).split(path.sep).join('/') + query;
        result = result.replace(match[0], JSON.stringify(relative));
      }
    }
    return result;
  }

  /**
   * Prepares a client module for chunk mode. It runs the passes the official
   * plugin runs before lowering JSX, and adds the helper marker instead of
   * lowering.
   */
  async function keepJSX(
    context: Rollup.TransformPluginContext,
    source: string,
    id: string,
  ): Promise<Rollup.TransformResult> {
    const filename = stripQuery(id);
    const solidCompiler = getCompiler();
    const maps: (string | null | undefined)[] = [];
    let code = source;

    // Fold and inline memos before bundling. A branch that folds away takes
    // its imports and `lazy()` chunks out of the module graph, which the
    // chunk step can no longer do. Inlining waits for the chunk, where the
    // components it can reach are known.
    const local = compile(code, { ...(await moduleOptions(context, code, id)), inline: false });
    if (local.map) {
      code = local.code;
      maps.push(local.map.toString());
    }

    const lazy = await solidCompiler.transformLazyAsync(code, { filename, sourceMap: true });
    code = lazy.code;
    maps.push(lazy.map);

    const lowering = jsxOptions(false);
    const dryRun = await solidCompiler.transformAsync(code, { ...lowering, filename });
    const needed = generatedImports(dryRun.code, filename, moduleName);
    if (needed.length > 0) {
      const marked = addMarker(code, filename, {
        moduleName,
        helpers: withRelated(needed),
        moduleSources,
        // The passes also recognize these primitives, which a chunk renames too.
        builtIns: new Set([...builtIns, 'createMemo']),
      });
      if (marked) {
        code = marked.code;
        maps.push(marked.map);
      }
    }

    code = await resolveLazyModuleUrls(context, code, filename);
    preserved.add(id);
    return { code, map: combineMaps(maps) };
  }

  const main = plugins.find((plugin) => plugin.name === 'solid');
  const originalTransform = main?.transform;
  const originalHandler =
    typeof originalTransform === 'function' ? originalTransform : originalTransform?.handler;
  if (main && originalHandler) {
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
      const result = compile(code, await moduleOptions(this, code, id));
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
        let repaired: { code: string; map: string } | undefined;
        let runtime: ReturnType<typeof readMarkers>;
        try {
          runtime = readMarkers(code, filename);
        } catch (error) {
          repaired = error instanceof SyntaxError ? repairJSXSequences(code, filename) : undefined;
          if (!repaired) {
            throw error;
          }
          runtime = readMarkers(repaired.code, filename);
        }
        if (!runtime) {
          return null;
        }
        const lowerChunk = (source: string): SolidCompiler.TransformResult =>
          getCompiler().transform(source, {
            ...jsxOptions(false),
            // The compiler picks its parser by extension, and a chunk is a `.js` file with JSX.
            filename: `${filename}.jsx`,
            sourceMap: true,
          });
        let optimized: CompileResult | undefined = compile(runtime.code, {
          ...compileOptions,
          filename,
          constantVars: true,
          builtInAliases: runtime.builtInAliases,
        });
        let linked: { code: string; map: string };
        let lowered: SolidCompiler.TransformResult;
        try {
          lowered = lowerChunk(optimized.code);
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
          lowered = lowerChunk(runtime.code);
          linked = linkHelpers(lowered.code, filename, moduleName, runtime.helpers);
        }
        return {
          code: linked.code,
          map: combineMaps([
            repaired?.map,
            runtime.map,
            optimized?.map?.toString(),
            lowered.map,
            linked.map,
          ]),
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
      // `vite:oxc` prints JSX like Rolldown does, without the parentheses a
      // comma expression needs in a JSX expression container.
      const repaired = repairJSXSequences(code, stripQuery(id));
      return repaired
        ? { code: repaired.code, map: repaired.map, moduleType: 'jsx' }
        : { code, moduleType: 'jsx' };
    },
  };

  return [modulePlugin, ...plugins, moduleTypePlugin, chunkPlugin];
}
