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
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import remapping from '@jridgewell/remapping';
import MagicString from 'magic-string';
import type * as SolidCompiler from '@solidjs/compiler';
import type { Options as SolidPluginOptions } from '@solidjs/vite-plugin';
import solidPlugin from '@solidjs/vite-plugin';
import type { Node, Program } from 'oxc-parser';
import type { Plugin, ResolvedConfig, Rollup } from 'vite';
import { createFilter, transformWithOxc } from 'vite';
import type { CompileOptions, CompileResult, ModuleConstants } from '../compile';
import { compile, readModuleConstants } from '../compile';
import { collectParents, parse } from '../ast';
import { analyzeScopes } from '../scope';
import { CONTEXT_SAFE_PRIMITIVES } from '../provider';
import type { ImportedConstants } from '../constants';
import { exposeLocals, readExportedComponent } from './inject';
import { nameNamespaceTags } from './namespace';
import type { UsageIndex } from './usage';
import { buildUsageIndex } from './usage';
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
  'fold' | 'inline' | 'alwaysInline' | 'contexts' | 'memos' | 'maxPasses'
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

/**
 * The local name of each value a module imports, keyed by its source and
 * the name it is imported as: an export name, `default`, or `*`.
 */
function importedNames(program: Program): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') {
      continue;
    }
    for (const specifier of statement.specifiers) {
      let imported = '*';
      if (specifier.type === 'ImportDefaultSpecifier') {
        imported = 'default';
      } else if (specifier.type === 'ImportSpecifier') {
        imported =
          specifier.imported.type === 'Identifier'
            ? specifier.imported.name
            : specifier.imported.value;
      }
      const typeOnly = specifier.type === 'ImportSpecifier' && specifier.importKind === 'type';
      if (!typeOnly) {
        names.set(`${statement.source.value}\0${imported}`, specifier.local.name);
      }
    }
  }
  return names;
}

/**
 * A key for a module in the build environment of `context`. The server and
 * client builds transform the same module into different code.
 */
function environmentKey(context: { environment?: { name: string } }, id: string): string {
  return `${context.environment?.name ?? ''}\0${id}`;
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
    alwaysInline: optimizer.alwaysInline,
    contexts: optimizer.contexts,
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

  /** The modules each transform waits for, so two never wait for each other. */
  const waiting = new Map<string, Set<string>>();

  /** Whether the transform of `from` waits, directly or not, for `to`. */
  const waitsFor = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
      if (current === to) {
        return true;
      }
      if (!seen.has(current)) {
        seen.add(current);
        stack.push(...(waiting.get(current) ?? []));
      }
    }
    return false;
  };

  /**
   * The code of a module with JSX, as the bundler loads it. `undefined`
   * when that module's transform waits for the importer, which would then
   * wait for it in turn.
   */
  async function loadModule(
    context: Rollup.PluginContext,
    importer: string,
    target: string,
  ): Promise<string | undefined> {
    if (waitsFor(target, importer)) {
      return undefined;
    }
    const targets = waiting.get(importer) ?? new Set<string>();
    targets.add(target);
    waiting.set(importer, targets);
    try {
      const info = await context.load({ id: target });
      return info.code ?? undefined;
    } finally {
      targets.delete(target);
    }
  }

  /**
   * The code of each module with JSX as this plugin's module step returned
   * it, before Solid's JSX transform lowers it. In module mode, an importer
   * copies components from it.
   */
  const recorded = new Map<string, string>();

  /** The modules with JSX each module imports, read from its file. */
  const jsxImports = new Map<string, Promise<string[]>>();

  /**
   * The modules with JSX a module imports. They come from the file on disk,
   * so they do not depend on the order modules are transformed in.
   */
  async function jsxImportsOf(context: Rollup.PluginContext, id: string): Promise<string[]> {
    let pending = jsxImports.get(id);
    if (!pending) {
      pending = (async () => {
        let code: string;
        try {
          code = await readFile(stripQuery(id), 'utf8');
        } catch {
          return [];
        }
        let program: Program;
        try {
          program = parse(stripQuery(id), code);
        } catch {
          return [];
        }
        const sources = new Set<string>();
        for (const statement of program.body) {
          if (
            (statement.type === 'ImportDeclaration' && statement.importKind !== 'type') ||
            ((statement.type === 'ExportNamedDeclaration' ||
              statement.type === 'ExportAllDeclaration') &&
              statement.source &&
              statement.exportKind !== 'type')
          ) {
            const value = statement.source?.value;
            if (value !== undefined && !moduleSources.includes(value)) {
              sources.add(value);
            }
          }
        }
        const resolved = await Promise.all(
          [...sources].map(async (source) => context.resolve(source, id)),
        );
        return resolved
          .filter((target) => target && !target.external && isJSXModule(target.id))
          .map((target) => target?.id ?? '');
      })();
      jsxImports.set(id, pending);
    }
    return pending;
  }

  /** Whether `from` imports `to`, directly or through other modules with JSX. */
  async function reaches(
    context: Rollup.PluginContext,
    from: string,
    to: string,
  ): Promise<boolean> {
    const seen = new Set<string>();
    let frontier = [from];
    while (frontier.length > 0) {
      if (frontier.includes(to)) {
        return true;
      }
      for (const id of frontier) {
        seen.add(id);
      }
      // oxlint-disable-next-line no-await-in-loop
      const next = await Promise.all(frontier.map(async (id) => jsxImportsOf(context, id)));
      frontier = [...new Set(next.flat())].filter((id) => !seen.has(id));
    }
    return false;
  }

  /**
   * The code of a module with JSX before Solid's JSX transform, with its
   * types stripped. A module that imports the importer back is skipped, so
   * no two transforms wait for each other, and the server and client builds
   * skip the same ones.
   */
  async function loadRecorded(
    context: Rollup.PluginContext,
    importer: string,
    target: string,
  ): Promise<string | undefined> {
    if (await reaches(context, target, importer)) {
      return undefined;
    }
    await context.load({ id: target });
    const code = recorded.get(environmentKey(context, target));
    if (code === undefined) {
      return undefined;
    }
    const stripped = await transformWithOxc(code, stripQuery(target), {
      jsx: 'preserve',
      sourcemap: false,
    });
    return stripped.code;
  }

  /**
   * The scripts an entry runs: the entry itself, or the module scripts of an
   * HTML entry. `undefined` when an HTML entry has an inline module script,
   * whose imports the usage index cannot read.
   */
  async function scriptEntries(
    context: Rollup.PluginContext,
    id: string,
  ): Promise<string[] | undefined> {
    if (/\.[mc]?[jt]sx?(?:\?|$)/.test(id)) {
      return [id];
    }
    let html: string;
    try {
      html = await readFile(stripQuery(id), 'utf8');
    } catch {
      return undefined;
    }
    const scripts: string[] = [];
    for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
      if (!/\btype\s*=\s*["']?module/i.test(tag)) {
        continue;
      }
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (src === undefined) {
        return undefined;
      }
      // oxlint-disable-next-line no-await-in-loop
      const resolved = await context.resolve(src, id);
      if (!resolved || resolved.external) {
        return undefined;
      }
      scripts.push(resolved.id);
    }
    return scripts;
  }

  /** How the app uses each export, built once per environment and build. */
  const usageIndexes = new Map<string, Promise<UsageIndex>>();

  /**
   * How the app uses each export, read from the modules the entries reach.
   */
  async function usageIndex(context: Rollup.PluginContext): Promise<UsageIndex> {
    const key = environmentKey(context, '');
    let pending = usageIndexes.get(key);
    if (!pending) {
      pending = (async () => {
        const entries = await Promise.all(
          [...context.getModuleIds()]
            .filter((id) => context.getModuleInfo(id)?.isEntry === true)
            .map(async (id) => scriptEntries(context, id)),
        );
        // A script the index cannot read could use any export.
        const known = entries.every((scripts) => scripts !== undefined);
        return buildUsageIndex(known ? entries.flat() : [], {
          resolve: async (source, importer) => {
            const resolved = await context.resolve(source, importer);
            return !resolved || resolved.external || resolved.id.includes('/node_modules/')
              ? undefined
              : resolved.id;
          },
          read: async (id) => {
            try {
              return await readFile(stripQuery(id), 'utf8');
            } catch {
              return undefined;
            }
          },
        });
      })();
      usageIndexes.set(key, pending);
    }
    return pending;
  }

  /**
   * The text that imports a binding under `local`.
   */
  function importText(local: string, imported: string, source: string): string {
    const from = JSON.stringify(source);
    if (imported === '*') {
      return `import * as ${local} from ${from};`;
    }
    if (imported === 'default') {
      return `import ${local} from ${from};`;
    }
    return `import { ${imported} as ${local} } from ${from};`;
  }

  interface Copy {
    /** The module and export the copy comes from. */
    readonly key: string;
    readonly name: string;
    /** The tags in the importer that call it. */
    readonly tags: Node[];
    readonly text: string;
  }

  interface CopyState {
    /** Components that cannot be copied, or were left over before. */
    readonly excluded: Set<string>;
    /** The contexts the copies import, by module. */
    readonly contexts: Map<string, Set<string>>;
    /** Imports a binding into the importer, and gives its local name. */
    readonly importAs: (base: string, imported: string, from: string) => string;
    /** The code of a module with JSX to copy from, or `undefined` to skip it. */
    readonly load: (target: string) => Promise<string | undefined>;
  }

  /**
   * Reads the component `source` exports as `imported`, and imports what it
   * needs into the importer. `undefined` when it cannot be copied.
   */
  async function copyImported(
    context: Rollup.PluginContext,
    id: string,
    source: string,
    imported: string,
    state: CopyState,
  ): Promise<{ key: string; text: (name: string) => string } | undefined> {
    const resolved = await context.resolve(source, id);
    if (
      !resolved ||
      resolved.external ||
      resolved.id === id ||
      resolved.id.includes('/node_modules/') ||
      !isJSXModule(resolved.id)
    ) {
      return undefined;
    }
    const key = `${resolved.id}\0${imported}`;
    if (state.excluded.has(key)) {
      return undefined;
    }
    const loaded = await state.load(resolved.id);
    const component = loaded
      ? readExportedComponent(loaded, stripQuery(resolved.id), imported, moduleSources)
      : undefined;
    if (!component) {
      state.excluded.add(key);
      return undefined;
    }
    // Each import of the module resolves from it, so the copy imports the same module.
    const targets = new Map<string, string>();
    for (const dependency of component.dependencies.values()) {
      if (dependency.kind === 'import' && !moduleSources.includes(dependency.source)) {
        // oxlint-disable-next-line no-await-in-loop
        const target = await context.resolve(dependency.source, resolved.id);
        if (!target) {
          state.excluded.add(key);
          return undefined;
        }
        targets.set(dependency.source, target.external ? dependency.source : target.id);
      }
    }
    const rename = new Map<string, string>();
    for (const [local, dependency] of component.dependencies) {
      if (dependency.kind === 'import') {
        const from = targets.get(dependency.source) ?? dependency.source;
        rename.set(local, state.importAs(local, dependency.imported, from));
        continue;
      }
      rename.set(local, state.importAs(local, dependency.exported, resolved.id));
      if (dependency.context) {
        const known = state.contexts.get(resolved.id) ?? new Set<string>();
        known.add(dependency.exported);
        state.contexts.set(resolved.id, known);
      }
    }
    return { key, text: (name) => component.copy(name, rename) };
  }

  /**
   * Copies the components a module imports from other modules with JSX into
   * it, and inlines them there. A copy the inline pass cannot inline at
   * every call is left out, so a component is never in both places. Copies
   * can import components in turn, which a few more rounds take in.
   */
  async function inlineImports(
    context: Rollup.PluginContext,
    source: string,
    id: string,
    compileOptionsOfModule: CompileOptions,
    load: (target: string) => Promise<string | undefined>,
  ): Promise<{ code: string; maps: string[] } | undefined> {
    const filename = stripQuery(id);
    const maps: string[] = [];
    const excluded = new Set<string>();
    const usage = await usageIndex(context);
    // The components copied here that leave their module, by module.
    const absorbed = new Map<string, Set<string>>();
    const isOnlyUser = (copy: Copy): boolean => {
      const [module = '', exported = ''] = copy.key.split('\0');
      return usage.isOnlyUser(module, exported, id, absorbed);
    };
    // The contexts the copies import, which the provider pass needs to know.
    const contexts = new Map<string, Set<string>>();
    let code = source;
    for (let round = 0; round < 4; round += 1) {
      const program = parse(filename, code);
      const scopes = analyzeScopes(program);
      const parents = collectParents(program);
      const names = new Set(scopes.names);
      const fresh = (base: string): string => {
        let name = base;
        for (let index = 1; names.has(name); index += 1) {
          name = `${base}$${String(index)}`;
        }
        names.add(name);
        return name;
      };

      // The module's own imports, so a copy reuses one instead of adding another.
      // Two imports of one context would be two bindings to the provider pass.
      const existing = importedNames(program);
      // Imports added in this round, shared by every copy.
      const imports: string[] = [];
      const added = new Map<string, string>();
      const importAs = (base: string, imported: string, from: string): string => {
        const key = `${from}\0${imported}`;
        const known = existing.get(key) ?? added.get(key);
        if (known !== undefined) {
          return known;
        }
        const name = fresh(base);
        added.set(key, name);
        imports.push(importText(name, imported, from));
        return name;
      };

      // Each imported binding used as a JSX tag, and its copy.
      const copies: Copy[] = [];
      for (const statement of program.body) {
        if (
          statement.type !== 'ImportDeclaration' ||
          statement.importKind === 'type' ||
          moduleSources.includes(statement.source.value)
        ) {
          continue;
        }
        for (const specifier of statement.specifiers) {
          const binding = scopes.root.bindings.get(specifier.local.name);
          // Only tags are copied. The import stays for any other use.
          const tags = (binding?.references ?? []).filter((reference) => {
            const parent = parents.get(reference);
            return (
              (parent?.type === 'JSXOpeningElement' || parent?.type === 'JSXClosingElement') &&
              parent.name === reference
            );
          });
          if (
            specifier.type === 'ImportNamespaceSpecifier' ||
            binding?.imported === undefined ||
            tags.length === 0
          ) {
            continue;
          }
          // oxlint-disable-next-line no-await-in-loop
          const copy = await copyImported(context, id, statement.source.value, binding.imported, {
            excluded,
            contexts,
            importAs,
            load,
          });
          if (copy) {
            const name = fresh(specifier.local.name);
            copies.push({ key: copy.key, name, tags, text: copy.text(name) });
          }
        }
      }
      if (copies.length === 0) {
        break;
      }

      // Drop the copies the inline pass leaves behind, and try again without them.
      let result: CompileResult | undefined;
      let edit: MagicString | undefined;
      for (let attempt = 0; attempt < 4 && copies.length > 0; attempt += 1) {
        edit = new MagicString(code);
        for (const copy of copies) {
          for (const tag of copy.tags) {
            edit.overwrite(tag.start, tag.end, copy.name);
          }
          edit.append(`\n${copy.text}\n`);
        }
        edit.append(`\n${imports.join('\n')}\n`);
        result = compile(edit.toString(), {
          ...compileOptionsOfModule,
          filename,
          sourceMap: true,
          importedContexts: Object.fromEntries(
            [...contexts].map(([module, exported]) => [module, [...exported]]),
          ),
          // The original of a copy stays in its module for its other users.
          sharedComponents: copies.filter((copy) => !isOnlyUser(copy)).map((copy) => copy.name),
        });
        const left = analyzeScopes(parse(filename, result.code)).root.bindings;
        const stuck = copies.filter((copy) => left.has(copy.name));
        if (stuck.length === 0) {
          break;
        }
        for (const copy of stuck) {
          excluded.add(copy.key);
          copies.splice(copies.indexOf(copy), 1);
        }
        result = undefined;
      }
      if (!result || !edit) {
        break;
      }
      // Their uses of other components move here with them.
      for (const copy of copies.filter(isOnlyUser)) {
        const [module = '', exported = ''] = copy.key.split('\0');
        absorbed.set(module, new Set([...(absorbed.get(module) ?? []), exported]));
      }
      maps.push(
        edit.generateMap({ source: filename, hires: true, includeContent: true }).toString(),
      );
      if (result.map) {
        maps.push(result.map.toString());
      }
      code = result.code;
    }
    return code === source ? undefined : { code, maps };
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
    const moduleCompileOptions = await moduleOptions(context, code, id);
    const local = compile(code, { ...moduleCompileOptions, inline: false });
    if (local.map) {
      code = local.code;
      maps.push(local.map.toString());
    }
    // `<Ns.Member>` would keep a namespace object, which lowered code does not.
    const named = nameNamespaceTags(code, filename);
    if (named) {
      code = named.code;
      maps.push(named.map);
    }

    // Components imported from other modules inline here, so the bundler
    // drops them, and what only they used, before it splits the chunks.
    if (moduleCompileOptions.inline !== false) {
      const imported = await inlineImports(
        context,
        code,
        id,
        moduleCompileOptions,
        async (target) => loadModule(context, id, target),
      );
      if (imported) {
        code = imported.code;
        maps.push(...imported.maps);
      }
    }
    // An entry's exports are its public API, so it gets no extra names.
    const exposed = context.getModuleInfo(id)?.isEntry ? undefined : exposeLocals(code, filename);
    if (exposed) {
      code = exposed.code;
      maps.push(exposed.map);
    }

    const lazy = await solidCompiler.transformLazyAsync(code, { filename, sourceMap: true });
    code = lazy.code;
    maps.push(lazy.map);

    // The helpers the module's JSX needs, as written and with its own
    // components inlined. Inlining can turn a spread into attributes, which
    // need helpers the spread did not.
    const lowering = jsxOptions(false);
    const needed = new Set<string>();
    const inlined =
      moduleCompileOptions.inline === false
        ? undefined
        : compile(code, { ...moduleCompileOptions, sourceMap: false });
    for (const version of new Set([code, inlined?.code ?? code])) {
      // oxlint-disable-next-line no-await-in-loop
      const dryRun = await solidCompiler.transformAsync(version, { ...lowering, filename });
      for (const helper of generatedImports(dryRun.code, filename, moduleName)) {
        needed.add(helper);
      }
    }
    if (needed.size > 0) {
      const marked = addMarker(code, filename, {
        moduleName,
        helpers: withRelated([...needed]),
        moduleSources,
        // The passes also recognize these primitives, which a chunk renames too.
        builtIns: new Set([...builtIns, 'createContext', ...CONTEXT_SAFE_PRIMITIVES]),
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
      jsxImports.clear();
      usageIndexes.clear();
    },
    watchChange() {
      moduleConstants.clear();
      jsxImports.clear();
      usageIndexes.clear();
    },
    async transform(source, id) {
      if (!isBuild() && optimizer.dev !== true) {
        return null;
      }
      if ((chunkMode() && isClient(this)) || !isJSXModule(id)) {
        return null;
      }
      const filename = stripQuery(id);
      const sourceOptions = await moduleOptions(this, source, id);
      const result = compile(source, sourceOptions);
      let code = result.code;
      const maps: (string | null | undefined)[] = [result.map?.toString()];
      // Components imported from other modules inline here too. The server
      // and client builds read the same modules, so they inline the same ones.
      if (isBuild() && sourceOptions.inline !== false) {
        const imported = await inlineImports(this, code, id, sourceOptions, async (target) =>
          loadRecorded(this, id, target),
        );
        if (imported) {
          code = imported.code;
          maps.push(...imported.maps);
        }
        // Entries get the extra exports too. The server and client builds
        // have different entries, and both have to copy the same components.
        const exposed = exposeLocals(code, filename);
        if (exposed) {
          code = exposed.code;
          maps.push(exposed.map);
        }
      }
      recorded.set(environmentKey(this, id), code);
      if (code === source) {
        return null;
      }
      return { code, map: combineMaps(maps) };
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
