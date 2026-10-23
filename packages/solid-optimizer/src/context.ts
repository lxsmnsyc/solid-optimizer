import type MagicString from 'magic-string';
import type { Node, Program } from 'oxc-parser';
import type { Parents } from './ast';
import type { ResolvedImportedConstants } from './constants';
import type { Binding, ScopeAnalysis } from './scope';
import type { Primitive } from './value';

export interface ResolvedOptions {
  /** The control-flow components a tag may resolve to. */
  readonly builtIns: ReadonlySet<string>;
  /** The modules Solid's built-in components are imported from. */
  readonly moduleSources: readonly string[];
  /** Top-level names that refer to a Solid export, keyed by name. */
  readonly builtInAliases: ReadonlyMap<string, string>;
  /** Whether a top-level `var` that nothing writes to counts as a constant. */
  readonly constantVars: boolean;
  /** The constants imported modules export, by import specifier and export name. */
  readonly importedConstants: ResolvedImportedConstants;
  /** Values of global names and paths, like `__DEV__` or `import.meta.env.MODE`. */
  readonly globalConstants: ReadonlyMap<string, Primitive>;
  /** The exports of imported modules that are contexts, by import specifier. */
  readonly importedContexts: ReadonlyMap<string, ReadonlySet<string>>;
  /** Components other modules use too, by the number of modules that use them. */
  readonly sharedComponents: ReadonlyMap<string, number>;
  /** Whether to inline components even where the copies are larger. */
  readonly alwaysInline: boolean;
}

/**
 * Whether a binding keeps the value it was declared with, like a `const`.
 *
 * `var` is excluded by default. A read before its declaration sees
 * `undefined` rather than throwing. A bundler turns top-level `const` into
 * `var`, so the `constantVars` option counts those too.
 */
export function isConstantDeclaration(binding: Binding, options: ResolvedOptions): boolean {
  if (binding.mutated) {
    return false;
  }
  if (binding.kind === 'const' || binding.kind === 'let') {
    return true;
  }
  return binding.kind === 'var' && options.constantVars && binding.scope.parent === undefined;
}

/**
 * The Solid export a binding refers to, by the name Solid exports it under.
 *
 * An import from a Solid module is decided by its exported name, so `m` from
 * `import { createMemo as m }` is `createMemo`. A bundled chunk declares or
 * imports Solid's exports under names the bundler chose, which
 * `builtInAliases` maps back.
 */
export function solidExport(binding: Binding, options: ResolvedOptions): string | undefined {
  if (binding.scope.parent === undefined && options.builtInAliases.has(binding.name)) {
    return options.builtInAliases.get(binding.name);
  }
  if (
    binding.kind === 'import' &&
    binding.source !== undefined &&
    options.moduleSources.includes(binding.source)
  ) {
    return binding.imported;
  }
  return undefined;
}

/** The passes that record what they leave alone. */
export type SkipPass = 'inline' | 'contexts' | 'memos';

/**
 * Something a pass left alone, and why. The `compile` option `report`
 * collects them.
 */
export interface Skip {
  readonly pass: SkipPass;
  /** A short code for the reason, like `call-spread`. */
  readonly reason: string;
  /** The component, context, or memo it is about. */
  readonly name: string;
}

/**
 * Everything a pass needs: the parsed code and the string it edits.
 *
 * A pass reads the AST of the code as it was before the pass started, and
 * writes its edits to `s`. The next pass parses the result again.
 */
export interface PassContext {
  readonly code: string;
  /** The file name, which picks the parser. */
  readonly filename: string;
  readonly s: MagicString;
  readonly program: Program;
  readonly parents: Parents;
  readonly scopes: ScopeAnalysis;
  readonly options: ResolvedOptions;
  /** Where a pass records what it leaves alone, when the caller asked for a report. */
  readonly skips: Skip[] | undefined;
}

/**
 * Records that a pass left something alone, when the caller asked for a report.
 */
export function recordSkip(
  context: PassContext,
  pass: SkipPass,
  reason: string,
  name: string,
): void {
  context.skips?.push({ pass, reason, name });
}

/**
 * The current text of `node`, including the edits made inside it so far.
 */
export function textOf(context: PassContext, node: Node): string {
  return context.s.slice(node.start, node.end);
}
