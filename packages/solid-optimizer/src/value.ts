/**
 * The constant lattice the fold pass evaluates against.
 *
 * Only primitives live here, and every operator runs on them natively, so a
 * folded value is exactly what the engine would produce. Evaluating an
 * operator on primitives runs no user code. Anything that could, like `in`,
 * `instanceof`, or an object operand, is not folded.
 */
import type { Expression, Node } from 'oxc-parser';

export type Primitive = string | number | boolean | null | undefined;

export interface Const {
  readonly value: Primitive;
}

/**
 * Looks up the constant a reference resolves to: an identifier, or a member
 * of a namespace import.
 */
export type ConstantLookup = (reference: Node) => Const | undefined;

function binary(operator: string, left: Primitive, right: Primitive): Const | undefined {
  switch (operator) {
    case '+':
      if (typeof left === 'string' || typeof right === 'string') {
        return { value: String(left) + String(right) };
      }
      return { value: Number(left) + Number(right) };
    case '-':
      return { value: Number(left) - Number(right) };
    case '*':
      return { value: Number(left) * Number(right) };
    case '/':
      return { value: Number(left) / Number(right) };
    case '%':
      return { value: Number(left) % Number(right) };
    case '**':
      return { value: Number(left) ** Number(right) };
    case '===':
      return { value: left === right };
    case '!==':
      return { value: left !== right };
    case '==':
      // Loose equality is the operator being folded, so it has to run as written.
      // oxlint-disable-next-line eqeqeq
      return { value: left == right };
    case '!=':
      // oxlint-disable-next-line eqeqeq
      return { value: left != right };
    case '<':
    case '<=':
    case '>':
    case '>=':
      return { value: compare(operator, left, right) };
    case '&':
      return { value: Number(left) & Number(right) };
    case '|':
      return { value: Number(left) | Number(right) };
    case '^':
      return { value: Number(left) ^ Number(right) };
    case '<<':
      return { value: Number(left) << Number(right) };
    case '>>':
      return { value: Number(left) >> Number(right) };
    case '>>>':
      return { value: Number(left) >>> Number(right) };
    default:
      return undefined;
  }
}

function compare(operator: string, left: Primitive, right: Primitive): boolean {
  // Two strings compare by code unit. Every other pair compares as numbers.
  if (typeof left === 'string' && typeof right === 'string') {
    switch (operator) {
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      default:
        return left >= right;
    }
  }
  const a = Number(left);
  const b = Number(right);
  switch (operator) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    default:
      return a >= b;
  }
}

function unary(operator: string, argument: Primitive): Const | undefined {
  switch (operator) {
    case '!':
      return { value: !argument };
    case 'typeof':
      return { value: typeof argument };
    case '+':
      return { value: Number(argument) };
    case '-':
      return { value: -Number(argument) };
    case '~':
      return { value: ~Number(argument) };
    case 'void':
      return { value: undefined };
    default:
      return undefined;
  }
}

/**
 * Evaluates `node` to a primitive, or returns `undefined` when it is not a
 * constant that evaluates without side effects.
 */
export function evaluate(node: Node, lookup: ConstantLookup): Const | undefined {
  switch (node.type) {
    case 'Literal':
      if (
        typeof node.value === 'string' ||
        typeof node.value === 'number' ||
        typeof node.value === 'boolean' ||
        node.value === null
      ) {
        // A regular expression whose flags the runtime does not support also has a `null` value.
        return 'regex' in node ? undefined : { value: node.value };
      }
      return undefined;
    case 'Identifier':
    case 'MemberExpression':
      return lookup(node);
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
      return evaluate(node.expression, lookup);
    case 'TemplateLiteral': {
      let out = '';
      for (const [index, quasi] of node.quasis.entries()) {
        // A cooked value of `null` means an invalid escape, which only a tagged template allows.
        if (quasi.value.cooked === null) {
          return undefined;
        }
        out += quasi.value.cooked;
        const expression = node.expressions.at(index);
        if (expression) {
          const value = evaluate(expression, lookup);
          if (!value) {
            return undefined;
          }
          out += String(value.value);
        }
      }
      return { value: out };
    }
    case 'UnaryExpression': {
      if (node.operator === 'delete') {
        return undefined;
      }
      const argument = evaluate(node.argument, lookup);
      return argument ? unary(node.operator, argument.value) : undefined;
    }
    case 'BinaryExpression': {
      const left = evaluate(node.left, lookup);
      if (!left) {
        return undefined;
      }
      const right = evaluate(node.right, lookup);
      return right ? binary(node.operator, left.value, right.value) : undefined;
    }
    case 'LogicalExpression': {
      const left = evaluate(node.left, lookup);
      if (!left) {
        return undefined;
      }
      let shortCircuits: boolean;
      if (node.operator === '&&') {
        shortCircuits = !left.value;
      } else if (node.operator === '||') {
        shortCircuits = !!left.value;
      } else {
        shortCircuits = left.value != null;
      }
      return shortCircuits ? left : evaluate(node.right, lookup);
    }
    case 'ConditionalExpression': {
      const test = evaluate(node.test, lookup);
      if (!test) {
        return undefined;
      }
      return evaluate(test.value ? node.consequent : node.alternate, lookup);
    }
    default:
      return undefined;
  }
}

/**
 * Whether `node` is known to be truthy or falsy.
 *
 * This is wider than `evaluate`. An object, array, function, class, or JSX
 * value has no constant value but is always truthy.
 */
export function truthiness(node: Node, lookup: ConstantLookup): boolean | undefined {
  switch (node.type) {
    case 'ObjectExpression':
    case 'ArrayExpression':
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'ClassExpression':
    case 'JSXElement':
    case 'JSXFragment':
      return true;
    case 'ParenthesizedExpression':
      return truthiness(node.expression, lookup);
    case 'UnaryExpression':
      if (node.operator === '!') {
        const value = truthiness(node.argument, lookup);
        return value === undefined ? undefined : !value;
      }
      break;
    case 'SequenceExpression': {
      // A sequence evaluates to its last expression. A fold that keeps an
      // effectful condition leaves one in test position.
      const last = node.expressions.at(-1);
      return last ? truthiness(last, lookup) : undefined;
    }
    default:
      break;
  }
  const value = evaluate(node, lookup);
  return value ? !!value.value : undefined;
}

/**
 * Whether skipping `node` entirely loses nothing observable.
 *
 * Every fold that reads a condition also discards it. `truthiness` answers
 * what a value is worth. This answers whether producing it can be skipped.
 * `[effect()]` is always truthy, yet evaluating it runs a call.
 */
export function isSideEffectFree(node: Node): boolean {
  switch (node.type) {
    // Creating a function does not run its body.
    case 'Literal':
    case 'Identifier':
    case 'ThisExpression':
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return true;
    case 'ParenthesizedExpression':
      return isSideEffectFree(node.expression);
    case 'TemplateLiteral':
      return node.expressions.every(isSideEffectFree);
    case 'UnaryExpression':
      // `delete` changes its target.
      return node.operator !== 'delete' && isSideEffectFree(node.argument);
    case 'BinaryExpression':
      // `in` and `instanceof` read the right operand's prototype chain, which a
      // proxy or `Symbol.hasInstance` can observe.
      return (
        node.operator !== 'in' &&
        node.operator !== 'instanceof' &&
        isSideEffectFree(node.left) &&
        isSideEffectFree(node.right)
      );
    case 'LogicalExpression':
      return isSideEffectFree(node.left) && isSideEffectFree(node.right);
    case 'SequenceExpression':
      return node.expressions.every(isSideEffectFree);
    case 'ConditionalExpression':
      return (
        isSideEffectFree(node.test) &&
        isSideEffectFree(node.consequent) &&
        isSideEffectFree(node.alternate)
      );
    case 'ArrayExpression':
      // A spread iterates its argument, which is observable.
      return node.elements.every(
        (element) =>
          element === null || (element.type !== 'SpreadElement' && isSideEffectFree(element)),
      );
    case 'ObjectExpression':
      return node.properties.every(
        (property) =>
          // A spread reads the source's own properties, which a getter observes.
          property.type === 'Property' &&
          (!property.computed || isSideEffectFree(property.key)) &&
          isSideEffectFree(property.value),
      );
    default:
      // A class is never skippable. Evaluating one runs its heritage
      // expression, computed keys, static fields, and static blocks.
      return false;
  }
}

/**
 * The parts of `node` that must still run when its value is discarded.
 * A sequence is flattened, and every part that can be skipped is dropped.
 */
export function effectfulParts(node: Expression, parts: Expression[] = []): Expression[] {
  if (isSideEffectFree(node)) {
    return parts;
  }
  if (node.type === 'SequenceExpression') {
    for (const part of node.expressions) {
      effectfulParts(part, parts);
    }
  } else if (node.type === 'ParenthesizedExpression') {
    effectfulParts(node.expression, parts);
  } else {
    parts.push(node);
  }
  return parts;
}

/**
 * The element count of an array literal with no spread elements.
 */
export function arrayLiteralLength(node: Node): number | undefined {
  if (node.type === 'ParenthesizedExpression') {
    return arrayLiteralLength(node.expression);
  }
  if (node.type !== 'ArrayExpression') {
    return undefined;
  }
  if (node.elements.some((element) => element?.type === 'SpreadElement')) {
    return undefined;
  }
  return node.elements.length;
}

/**
 * The source text of a constant, or `undefined` when it has no literal
 * spelling worth emitting. `undefined`, `NaN`, the infinities, and `-0`
 * need an expression or a global that a local binding could shadow.
 */
export function literalText(value: Primitive): string | undefined {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return String(value);
    case 'number':
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        return undefined;
      }
      // A negative number is a unary expression. The parentheses keep it one
      // operand wherever it lands, such as `a - (-1)` or `(-1).toFixed()`.
      return value < 0 ? `(${String(value)})` : String(value);
    case 'object':
      return 'null';
    default:
      return undefined;
  }
}

/**
 * Whether `node` is already the spelling `literalText` would produce.
 * Folding it again would change nothing.
 */
export function isLiteralForm(node: Node): boolean {
  switch (node.type) {
    case 'Literal':
      return true;
    case 'UnaryExpression':
      return (
        node.operator === '-' &&
        node.argument.type === 'Literal' &&
        typeof node.argument.value === 'number'
      );
    case 'ParenthesizedExpression':
      return isLiteralForm(node.expression);
    default:
      return false;
  }
}
