import type { Expression, JSXChild, Node, Program } from 'oxc-parser';
import { parseSync, visitorKeys } from 'oxc-parser';

/**
 * Keys that only hold TypeScript types. Types never run, so no pass reads or rewrites them.
 */
const TYPE_KEYS = new Set([
  'typeAnnotation',
  'typeParameters',
  'typeArguments',
  'returnType',
  'superTypeArguments',
  'implements',
]);

/**
 * TypeScript nodes that wrap a runtime expression.
 * Every other TypeScript node is skipped along with its children.
 */
const TS_EXPRESSION_WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'TSInstantiationExpression',
  'TSExportAssignment',
]);

export function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  );
}

/**
 * Calls `visit` for each child node of `node`, in source order.
 */
export function forEachChild(node: Node, visit: (child: Node) => void): void {
  if (node.type.startsWith('TS')) {
    if (TS_EXPRESSION_WRAPPERS.has(node.type)) {
      const expression: unknown = Reflect.get(node, 'expression');
      if (isNode(expression)) {
        visit(expression);
      }
    } else if (node.type === 'TSParameterProperty') {
      visit(node.parameter);
    }
    return;
  }
  if (!Object.hasOwn(visitorKeys, node.type)) {
    return;
  }
  for (const key of visitorKeys[node.type]) {
    if (TYPE_KEYS.has(key)) {
      continue;
    }
    const value: unknown = Reflect.get(node, key);
    if (Array.isArray(value)) {
      const items: unknown[] = value;
      for (const item of items) {
        if (isNode(item)) {
          visit(item);
        }
      }
    } else if (isNode(value)) {
      visit(value);
    }
  }
}

export type Parents = Map<Node, Node>;

export function collectParents(program: Program): Parents {
  const parents: Parents = new Map();
  const visit = (node: Node): void => {
    forEachChild(node, (child) => {
      parents.set(child, node);
      visit(child);
    });
  };
  visit(program);
  return parents;
}

export function parse(filename: string, code: string): Program {
  const result = parseSync(filename, code, {
    lang: languageOf(filename),
    sourceType: 'module',
    preserveParens: true,
  });
  const error = result.errors.at(0);
  if (error) {
    throw new SyntaxError(`[solid-optimizer] ${filename}: ${error.codeframe ?? error.message}`);
  }
  return result.program;
}

function languageOf(filename: string): 'jsx' | 'ts' | 'tsx' {
  if (/\.tsx$/i.test(filename)) {
    return 'tsx';
  }
  if (/\.[cm]?ts$/i.test(filename)) {
    return 'ts';
  }
  // Plain `.js` files are parsed as JSX, since bundled chunks keep the JSX they preserved.
  return 'jsx';
}

/**
 * Removes the parentheses and TypeScript wrappers around an expression.
 */
export function unwrap(node: Expression): Expression {
  let current = node;
  while (
    current.type === 'ParenthesizedExpression' ||
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSTypeAssertion'
  ) {
    current = current.expression;
  }
  return current;
}

export function isFunctionNode(node: Node): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

/**
 * An intrinsic element name, such as `div` or `my-element`.
 * JSX treats a lowercase first letter as an intrinsic element.
 */
export function isIntrinsicTag(name: string): boolean {
  return /^[a-z][\w-]*$/.test(name);
}

/**
 * Whether JSX drops this text: whitespace that contains a line break.
 */
export function isFilteredText(child: JSXChild): boolean {
  return child.type === 'JSXText' && /^\s*$/.test(child.value) && /[\r\n]/.test(child.value);
}

/**
 * Whether a JSX element or fragment sits in a list of JSX children.
 */
export function isJSXChild(node: Node, parents: Parents): boolean {
  const parent = parents.get(node);
  return parent?.type === 'JSXElement' || parent?.type === 'JSXFragment';
}

/**
 * Node types that bind tighter than any operator, so their text can replace
 * any expression without parentheses.
 */
const PRIMARY_TYPES = new Set([
  'Identifier',
  'Literal',
  'ThisExpression',
  'ArrayExpression',
  'TemplateLiteral',
  'ParenthesizedExpression',
  'JSXElement',
  'JSXFragment',
]);

export function isPrimary(node: Node): boolean {
  if (node.type === 'Literal') {
    // `-1` is a unary expression, but a literal like `1` is primary.
    return typeof node.value !== 'number' || node.value >= 0;
  }
  return PRIMARY_TYPES.has(node.type);
}

/**
 * The node that starts an expression's text, such as `a` in `a.b()`.
 */
function leftmost(node: Node): Node {
  switch (node.type) {
    case 'MemberExpression':
      return leftmost(node.object);
    case 'CallExpression':
      return leftmost(node.callee);
    case 'TaggedTemplateExpression':
      return leftmost(node.tag);
    case 'BinaryExpression':
    case 'LogicalExpression':
      return leftmost(node.left);
    case 'AssignmentExpression':
      return leftmost(node.left);
    case 'ConditionalExpression':
      return leftmost(node.test);
    case 'SequenceExpression':
      return node.expressions[0] ? leftmost(node.expressions[0]) : node;
    case 'ChainExpression':
      return leftmost(node.expression);
    case 'UpdateExpression':
      return node.prefix ? node : leftmost(node.argument);
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      return leftmost(node.expression);
    default:
      return node;
  }
}

/**
 * Whether `replacement` needs parentheses to take the place of `target`.
 *
 * Replacing an expression with one of its own operands never needs them, since an operand
 * binds at least as tightly as the expression around it. The exceptions are the positions
 * where the first token decides what the parser reads: a statement cannot start with `{`,
 * `function`, or `class`, and neither can an arrow function body.
 */
export function needsParensAt(target: Node, replacement: Node, parents: Parents): boolean {
  const parent = parents.get(target);
  if (parent === undefined) {
    return false;
  }
  const statementStart =
    parent.type === 'ExpressionStatement' ||
    parent.type === 'ExportDefaultDeclaration' ||
    (parent.type === 'ArrowFunctionExpression' && parent.body === target);
  if (!statementStart) {
    return false;
  }
  const first = leftmost(replacement);
  return (
    startsLikeStatement(first) ||
    // A string at the start of a statement can turn into a directive, like `"use strict"`.
    (first.type === 'Literal' && typeof first.value === 'string')
  );
}

/**
 * Whether an expression statement starting with `node` would parse as
 * something else: a block, a function declaration, or a class declaration.
 */
export function startsLikeStatement(node: Node): boolean {
  const first = leftmost(node);
  return (
    first.type === 'ObjectExpression' ||
    first.type === 'FunctionExpression' ||
    first.type === 'ClassExpression'
  );
}
