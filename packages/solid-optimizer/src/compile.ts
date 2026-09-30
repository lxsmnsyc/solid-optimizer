import type { SourceMap } from '@jridgewell/remapping';
import remapping from '@jridgewell/remapping';
import MagicString from 'magic-string';
import { collectParents, parse } from './ast';
import type { PassContext, ResolvedOptions } from './context';
import { fold } from './fold';
import { inline } from './inline';
import { inlineMemos } from './memo';
import { simplifyServer } from './server';
import { analyzeScopes } from './scope';

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

type Pass = (context: PassContext) => boolean;

interface PassResult {
  code: string;
  map: string | undefined;
}

function runPass(
  code: string,
  filename: string,
  options: ResolvedOptions,
  sourceMap: boolean,
  pass: Pass,
): PassResult | undefined {
  const program = parse(filename, code);
  const context: PassContext = {
    code,
    s: new MagicString(code),
    program,
    parents: collectParents(program),
    scopes: analyzeScopes(program),
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
  const resolved: ResolvedOptions = {
    builtIns: new Set(options.builtIns ?? DEFAULT_BUILT_INS),
    moduleSources: options.moduleSources ?? DEFAULT_MODULE_SOURCES,
    builtInAliases: new Map(Object.entries(options.builtInAliases ?? {})),
    constantVars: options.constantVars ?? false,
  };
  const passes: Pass[] = [];
  if (options.fold ?? true) {
    passes.push(fold);
  }
  if (options.inline ?? true) {
    passes.push(inline);
  }
  if (options.memos ?? true) {
    passes.push(inlineMemos);
  }

  const maps: string[] = [];
  let current = code;
  const maxPasses = options.maxPasses ?? 10;
  for (let round = 0; round < maxPasses; round += 1) {
    let changed = false;
    for (const pass of passes) {
      const result = runPass(current, filename, resolved, sourceMap, pass);
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
    const result = runPass(current, filename, resolved, sourceMap, simplifyServer);
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
