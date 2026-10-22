/**
 * Keeps a `ref` that names a variable working through bundling.
 *
 * Solid's JSX transform turns `<input ref={el} />` into code that assigns
 * the element to `el`. In chunk mode the JSX reaches the bundler before that
 * code exists, so the bundler only sees `el` read. A `let el` that nothing
 * else writes to then looks like it is always `undefined`, and the bundler
 * folds its reads, like `el ? el.value : ''`, to the `undefined` branch.
 *
 * Before bundling, `ref={el}` becomes `ref={__SO_REF__(el, (v) => (el = v))}`,
 * which shows the bundler the write. The bundler renames both uses of `el`
 * alike. Before the chunk is lowered, the call becomes `ref={el}` again, so
 * the JSX transform writes the same code it would have.
 */
import type { CallExpression, JSXAttribute, Node } from 'oxc-parser';
import MagicString from 'magic-string';
import { forEachChild, parse } from '../ast';
import { analyzeScopes } from '../scope';
import type { EditResult } from './runtime';

export const REF_MARKER = '__SO_REF__';

function generateMap(s: MagicString, filename: string): string {
  return s.generateMap({ source: filename, hires: true, includeContent: true }).toString();
}

function isRefAttribute(node: Node): node is JSXAttribute {
  return (
    node.type === 'JSXAttribute' && node.name.type === 'JSXIdentifier' && node.name.name === 'ref'
  );
}

/**
 * Wraps each `ref` whose value is a `let` or `var` binding, so the bundler
 * sees it written. `undefined` when there is none.
 */
export function protectRefs(code: string, filename: string): EditResult | undefined {
  if (!code.includes('ref')) {
    return undefined;
  }
  const program = parse(filename, code);
  const scopes = analyzeScopes(program);
  const s = new MagicString(code);
  const visit = (node: Node): void => {
    if (isRefAttribute(node) && node.value?.type === 'JSXExpressionContainer') {
      const { expression } = node.value;
      const binding =
        expression.type === 'Identifier' ? scopes.references.get(expression) : undefined;
      if (
        expression.type === 'Identifier' &&
        (binding?.kind === 'let' || binding?.kind === 'var')
      ) {
        const { name } = expression;
        s.overwrite(
          expression.start,
          expression.end,
          `${REF_MARKER}(${name}, (__so_ref) => (${name} = __so_ref))`,
        );
      }
    }
    forEachChild(node, visit);
  };
  visit(program);
  return s.hasChanged() ? { code: s.toString(), map: generateMap(s, filename) } : undefined;
}

/**
 * Turns each wrapped `ref` back into its variable. `undefined` when there
 * is none.
 */
export function restoreRefs(code: string, filename: string): EditResult | undefined {
  if (!code.includes(REF_MARKER)) {
    return undefined;
  }
  const program = parse(filename, code);
  const s = new MagicString(code);
  const visit = (node: Node): void => {
    if (isRefAttribute(node) && node.value?.type === 'JSXExpressionContainer') {
      const { expression } = node.value;
      if (isMarkerCall(expression)) {
        const target = expression.arguments.at(0);
        if (target?.type === 'Identifier') {
          s.overwrite(expression.start, expression.end, target.name);
        }
      }
    }
    forEachChild(node, visit);
  };
  visit(program);
  return s.hasChanged() ? { code: s.toString(), map: generateMap(s, filename) } : undefined;
}

function isMarkerCall(node: Node): node is CallExpression {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === REF_MARKER
  );
}
