/**
 * Measures a component's copy at a call site: folds it, and inlines the
 * components it calls, as the passes after inlining would. Then it estimates
 * its size with `SizeEstimator`.
 */
import MagicString from 'magic-string';
import { collectParents, parse } from './ast';
import type { PassContext, ResolvedOptions } from './context';
import { fold } from './fold';
import { analyzeScopes } from './scope';
import { SizeEstimator } from './size';

/**
 * The name of the function a copy is wrapped in to be folded and measured.
 * It is capitalized, so the inline pass can move statements into it.
 */
const WRAPPER = 'SoSize$$';

/**
 * How many copies are being measured inside each other. Components that
 * call each other would otherwise measure each other without end.
 */
let depth = 0;
const MAX_DEPTH = 3;

/** The module's components a copy calls, which can inline into it. */
export interface CalledComponents {
  /** Their declarations. */
  readonly declarations: string;
  /** The inline pass. It is passed in, since it measures copies with this module. */
  readonly inline: (context: PassContext) => boolean;
}

export interface Copy {
  /** The statements the copy hoists out of the JSX. */
  readonly statements: readonly string[];
  /** The JSX that replaces the call site. */
  readonly root: string;
}

/**
 * The size of a component's copy at one call site, once its props have
 * folded. `header` declares the names the fold pass needs to know, like
 * imports of Solid. `called` holds the module's components the copy calls,
 * which inline into it when its props resolve their call sites.
 * `inTemplate` is whether the call site sits directly in an element.
 * `measured` receives the code that was measured.
 */
export function copySize(
  filename: string,
  header: string,
  copy: Copy,
  inTemplate: boolean,
  options: ResolvedOptions,
  called?: CalledComponents,
  measured?: { code: string },
): number {
  const calls = depth < MAX_DEPTH ? called : undefined;
  let code = `${header}\n${calls?.declarations ?? ''}\nfunction ${WRAPPER}() {\n${copy.statements.join('\n')}\nreturn (${copy.root});\n}\n`;
  // Constant props fold the copy's conditions, and can let the calls in it
  // inline, as later passes would.
  for (let round = 0; round < 4; round += 1) {
    let changed = false;
    for (const pass of calls ? [fold, calls.inline] : [fold]) {
      const program = parse(filename, code);
      const s = new MagicString(code);
      depth += 1;
      let passChanged: boolean;
      try {
        passChanged = pass({
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
      } finally {
        depth -= 1;
      }
      if (passChanged) {
        code = s.toString();
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  if (measured) {
    measured.code = code;
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
