/**
 * Ends each statement that relies on a line break.
 *
 * The other passes replace a read with text that can start with `(` or a
 * template literal, like `(p.close)()` for `props.close()`. After a statement
 * with no semicolon, that text continues the statement instead of starting a
 * new one, so `open()` and `(p.close)()` on separate lines call what `open()`
 * returned. A semicolon keeps the statements the parser found.
 */
import type { Node } from 'oxc-parser';
import { forEachChild } from './ast';
import type { PassContext } from './context';

const TERMINATED = new Set([
  'BreakStatement',
  'ContinueStatement',
  'DebuggerStatement',
  'DoWhileStatement',
  'ExportAllDeclaration',
  'ExpressionStatement',
  'ImportDeclaration',
  'ReturnStatement',
  'ThrowStatement',
  'TSTypeAliasDeclaration',
  'VariableDeclaration',
]);

const LOOP_HEADS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement']);

function isTerminated(node: Node, context: PassContext): boolean {
  if (node.type === 'VariableDeclaration') {
    const parent = context.parents.get(node);
    return !(parent && LOOP_HEADS.has(parent.type) && Reflect.get(parent, 'body') !== node);
  }
  if (node.type === 'ExportNamedDeclaration') {
    return !node.declaration;
  }
  if (node.type === 'ExportDefaultDeclaration') {
    const { type } = node.declaration;
    return type !== 'FunctionDeclaration' && type !== 'ClassDeclaration';
  }
  return TERMINATED.has(node.type);
}

const TRIVIA = /(?:\s|\/\/[^\n\r\u2028\u2029]*|\/\*[\s\S]*?\*\/)*/y;

/** Whether code other than the closing brace of a block follows `position`. */
function hasCodeAfter(code: string, position: number): boolean {
  TRIVIA.lastIndex = position;
  TRIVIA.exec(code);
  return TRIVIA.lastIndex < code.length && code[TRIVIA.lastIndex] !== '}';
}

export function terminateStatements(context: PassContext): boolean {
  const { code, s } = context;
  let changed = false;
  const visit = (node: Node): void => {
    if (isTerminated(node, context) && code[node.end - 1] !== ';' && hasCodeAfter(code, node.end)) {
      s.appendLeft(node.end, ';');
      changed = true;
    }
    forEachChild(node, visit);
  };
  visit(context.program);
  return changed;
}
