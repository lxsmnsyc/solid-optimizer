import type MagicString from 'magic-string';
import type { Node, Program } from 'oxc-parser';
import type { Parents } from './ast';
import type { ScopeAnalysis } from './scope';

export interface ResolvedOptions {
  /** The control-flow components a tag may resolve to. */
  readonly builtIns: ReadonlySet<string>;
  /** The modules Solid's built-in components are imported from. */
  readonly moduleSources: readonly string[];
}

/**
 * Everything a pass needs: the parsed code and the string it edits.
 *
 * A pass reads the AST of the code as it was before the pass started, and
 * writes its edits to `s`. The next pass parses the result again.
 */
export interface PassContext {
  readonly code: string;
  readonly s: MagicString;
  readonly program: Program;
  readonly parents: Parents;
  readonly scopes: ScopeAnalysis;
  readonly options: ResolvedOptions;
}

/**
 * The current text of `node`, including the edits made inside it so far.
 */
export function textOf(context: PassContext, node: Node): string {
  return context.s.slice(node.start, node.end);
}
