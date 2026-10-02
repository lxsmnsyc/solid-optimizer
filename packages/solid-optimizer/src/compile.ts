import type { SourceMap } from '@jridgewell/remapping';
import type { Program } from 'oxc-parser';
import remapping from '@jridgewell/remapping';
import MagicString from 'magic-string';
import type { Parents } from './ast';
import { collectParents, parse } from './ast';
import type { ImportedConstants } from './constants';
import { constantExports, namedImportSources, resolveImportedConstants } from './constants';
import type { PassContext, ResolvedOptions } from './context';
import { fold } from './fold';
import { inline } from './inline';
import { inlineMemos } from './memo';
import { simplifyServer } from './server';
import { removeProviders } from './provider';
import type { ScopeAnalysis } from './scope';
import { analyzeScopes } from './scope';
import type { Primitive } from './value';

export interface CompileOptions {
  /**
   * The file name, used to pick the parser (`.ts` and `.tsx` parse as
   * TypeScript, anything else as JSX) and as the source in the source map.
   *
   * @default 'input.jsx'
   */
  filename?: string;
  /**
   * Fold constants, remove unreachable code, and resolve control-flow
   * components whose props are constants.
   *
   * @default true
   */
  fold?: boolean;
  /**
   * Replace component calls with the component's body.
   *
   * @default true
   */
  inline?: boolean;
  /**
   * Compile for the server: remove `createEffect` and `onMount`, and reduce
   * `untrack`, `batch`, `startTransition`, `createDeferred`, `getListener`,
   * `createMemo`, `createRenderEffect`, and `createComputed` to what they do
   * on the server.
   *
   * This runs once, after the other passes. The server and client build
   * make the same folding and inlining decisions from the same code, so the
   * server renders the tree the client hydrates.
   *
   * @default false
   */
  server?: boolean;
  /**
   * Remove context providers whose reads are all visible, and give each
   * read the provider's value.
   *
   * @default true
   */
  contexts?: boolean;
  /**
   * Replace a `createMemo` that always produces a new value and is read once
   * with its computation.
   *
   * @default true
   */
  memos?: boolean;
  /**
   * The names of Solid's built-in components. A tag only folds when it is
   * one of these, and an empty list turns control-flow folding off.
   *
   * @default ['For', 'Show', 'Switch', 'Match', 'Suspense', 'SuspenseList', 'Portal', 'Index', 'Dynamic', 'ErrorBoundary']
   */
  builtIns?: readonly string[];
  /**
   * The modules that export Solid's built-in components. A tag imported from
   * anywhere else is a different component.
   *
   * @default ['solid-js', 'solid-js/web']
   */
  moduleSources?: readonly string[];
  /**
   * Top-level names that refer to Solid's built-in components, mapped to the
   * built-in's name. A bundler renames bindings, so a chunk can call `Show`
   * something else, or declare it instead of importing it.
   */
  builtInAliases?: Readonly<Record<string, string>>;
  /**
   * Treat a top-level `var` that nothing writes to as a constant. Bundlers
   * turn top-level `const` into `var`, so this is on for bundled chunks.
   *
   * @default false
   */
  constantVars?: boolean;
  /**
   * The constants imported modules export, keyed by the import specifier as
   * the code writes it, then by export name. An import of one of them folds
   * like a local `const`. `constantExports` reads them from a module.
   */
  importedConstants?: ImportedConstants;
  /**
   * The exports of imported modules that are contexts made by Solid's
   * `createContext`, keyed by the import specifier as the code writes it.
   * A provider of an imported context can be removed like a local one.
   */
  importedContexts?: Readonly<Record<string, readonly string[]>>;
  /**
   * Top-level components that other modules use too, by the number of
   * modules that use them, this one included. Inlining one here only counts
   * its share of the declaration, which goes away once every one of them
   * inlines it. `0` keeps it whatever is inlined, like a component that is
   * also passed as a value.
   */
  sharedComponents?: Readonly<Record<string, number>>;
  /**
   * Inline every component that can be, even where the copies are larger
   * than the calls and declaration they replace. By default, a component is
   * only inlined where its copies are estimated to be no larger.
   *
   * @default false
   */
  alwaysInline?: boolean;
  /**
   * The most passes to run. One pass can expose work for the next, such as
   * an inlined component whose props now fold. Compilation stops early once
   * a pass changes nothing.
   *
   * @default 10
   */
  maxPasses?: number;
  /**
   * Generate a source map.
   *
   * @default true
   */
  sourceMap?: boolean;
}

export interface CompileResult {
  code: string;
  /** The map from the output back to the input, or `null` when nothing changed or maps are off. */
  map: SourceMap | null;
}

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

const DEFAULT_MODULE_SOURCES = ['solid-js', 'solid-js/web'];

function resolveOptions(options: CompileOptions): ResolvedOptions {
  return {
    builtIns: new Set(options.builtIns ?? DEFAULT_BUILT_INS),
    moduleSources: options.moduleSources ?? DEFAULT_MODULE_SOURCES,
    builtInAliases: new Map(Object.entries(options.builtInAliases ?? {})),
    constantVars: options.constantVars ?? false,
    importedConstants: resolveImportedConstants(options.importedConstants),
    importedContexts: new Map(
      Object.entries(options.importedContexts ?? {}).map(([source, names]) => [
        source,
        new Set(names),
      ]),
    ),
    sharedComponents: new Map(Object.entries(options.sharedComponents ?? {})),
    alwaysInline: options.alwaysInline ?? false,
  };
}

type Pass = (context: PassContext) => boolean;

interface PassResult {
  code: string;
  map: string | undefined;
}

/** A parse of some code, which passes that change nothing can share. */
interface Parsed {
  readonly code: string;
  readonly program: Program;
  readonly parents: Parents;
  readonly scopes: ScopeAnalysis;
}

function parseCode(code: string, filename: string): Parsed {
  const program = parse(filename, code);
  return { code, program, parents: collectParents(program), scopes: analyzeScopes(program) };
}

function runPass(
  parsed: Parsed,
  filename: string,
  options: ResolvedOptions,
  sourceMap: boolean,
  pass: Pass,
): PassResult | undefined {
  const { code } = parsed;
  const context: PassContext = {
    code,
    filename,
    s: new MagicString(code),
    program: parsed.program,
    parents: parsed.parents,
    // A pass adds the names it gives out, so each pass starts from the parse's own.
    scopes: { ...parsed.scopes, names: new Set(parsed.scopes.names) },
    options,
  };
  if (!pass(context)) {
    return undefined;
  }
  return {
    code: context.s.toString(),
    map: sourceMap
      ? context.s.generateMap({ source: filename, hires: true, includeContent: true }).toString()
      : undefined,
  };
}

/**
 * Optimizes JSX before it is lowered by Solid's JSX transform.
 *
 * The input is JavaScript or TypeScript with JSX, such as a module, or a
 * bundled chunk that kept its JSX. The output keeps JSX too, so the JSX
 * transform runs after this.
 *
 * The output changes the shape of the rendered tree, and with it the
 * hydration keys. A server build and its client build must compile the same
 * code with the same options.
 */
export function compile(code: string, options: CompileOptions = {}): CompileResult {
  const filename = options.filename ?? 'input.jsx';
  const sourceMap = options.sourceMap ?? true;
  const resolved = resolveOptions(options);
  const passes: Pass[] = [];
  if (options.fold ?? true) {
    passes.push(fold);
  }
  if (options.inline ?? true) {
    passes.push(inline);
  }
  if (options.contexts ?? true) {
    passes.push(removeProviders);
  }
  if (options.memos ?? true) {
    passes.push(inlineMemos);
  }

  const maps: string[] = [];
  let current = code;
  // A pass that changes nothing leaves the code as it was, so the next pass
  // reuses the parse instead of parsing the same code again.
  let parsed: Parsed | undefined;
  const parsedCurrent = (): Parsed => {
    if (parsed?.code !== current) {
      parsed = parseCode(current, filename);
    }
    return parsed;
  };
  const maxPasses = options.maxPasses ?? 10;
  for (let round = 0; round < maxPasses; round += 1) {
    let changed = false;
    for (const pass of passes) {
      const result = runPass(parsedCurrent(), filename, resolved, sourceMap, pass);
      if (result) {
        changed = true;
        current = result.code;
        if (result.map !== undefined) {
          maps.push(result.map);
        }
      }
    }
    if (!changed) {
      break;
    }
  }

  if (options.server ?? false) {
    const result = runPass(parsedCurrent(), filename, resolved, sourceMap, simplifyServer);
    if (result) {
      current = result.code;
      if (result.map !== undefined) {
        maps.push(result.map);
      }
    }
  }

  if (maps.length === 0) {
    return { code: current, map: null };
  }
  // Each map points at the output of the pass before it, so they chain from the last one.
  return { code: current, map: remapping(maps.reverse(), () => null) };
}

export interface ModuleConstants {
  /**
   * The modules this module imports or re-exports named bindings from, as
   * written. `importedConstants` of `compile` takes their constants.
   */
  imports: string[];
  /**
   * The constants this module exports, by export name: `export const`
   * bindings whose value folds, names exported from them, and names
   * re-exported from `importedConstants`.
   */
  exports: Record<string, Primitive>;
}

/**
 * Reads what a module imports and the constants it exports, so that
 * `compile` can fold them in the modules that import it.
 *
 * Only `filename` and `importedConstants` of the options are used.
 */
export function readModuleConstants(
  code: string,
  options: Pick<CompileOptions, 'filename' | 'importedConstants'> = {},
): ModuleConstants {
  const program = parse(options.filename ?? 'input.jsx', code);
  return {
    imports: namedImportSources(program),
    exports: constantExports(program, resolveOptions(options)),
  };
}
