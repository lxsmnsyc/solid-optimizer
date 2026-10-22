/**
 * Measures a component's copy at a call site: folds it as the passes after
 * inlining would, then estimates its size with `SizeEstimator`.
 */
import MagicString from 'magic-string';
import { collectParents, parse } from './ast';
import type { ResolvedOptions } from './context';
import { fold } from './fold';
import { analyzeScopes } from './scope';
import { SizeEstimator } from './size';

/** The name of the function a copy is wrapped in to be folded and measured. */
const WRAPPER = '__so_size__';

export interface Copy {
  /** The statements the copy hoists out of the JSX. */
  readonly statements: readonly string[];
  /** The JSX that replaces the call site. */
  readonly root: string;
}

/**
 * The size of a component's copy at one call site, once its props have
 * folded. `header` declares the names the fold pass needs to know, like
 * imports of Solid. `inTemplate` is whether the call site sits directly in
 * an element.
 */
export function copySize(
  filename: string,
  header: string,
  copy: Copy,
  inTemplate: boolean,
  options: ResolvedOptions,
): number {
  let code = `${header}\nfunction ${WRAPPER}() {\n${copy.statements.join('\n')}\nreturn (${copy.root});\n}\n`;
  // Constant props fold the copy's conditions, as later passes would.
  for (let round = 0; round < 3; round += 1) {
    const program = parse(filename, code);
    const s = new MagicString(code);
    const changed = fold({
      code,
      filename,
      s,
      program,
      parents: collectParents(program),
      scopes: analyzeScopes(program),
      options,
      // Only the copy is measured, so nothing it skips is reported.
      skips: undefined,
    });
    if (!changed) {
      break;
    }
    code = s.toString();
  }
  const program = parse(filename, code);
  const wrapper = program.body.at(-1);
  if (wrapper?.type !== 'FunctionDeclaration' || !wrapper.body) {
    return Number.POSITIVE_INFINITY;
  }
  const estimator = new SizeEstimator(code);
  let size = 0;
  for (const statement of wrapper.body.body) {
    if (statement.type !== 'ReturnStatement') {
      size += estimator.node(statement);
      continue;
    }
    if (statement.argument) {
      size += estimator.root(statement.argument, inTemplate);
    }
  }
  return size;
}
