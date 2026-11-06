import type { ExpressionStatement } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { parse, unwrap } from '../src/ast';

/** The expression of the first statement in `code`, parsed as TypeScript. */
function expressionOf(code: string): ExpressionStatement['expression'] {
  const statement = parse('input.ts', code).body.at(0);
  if (statement?.type !== 'ExpressionStatement') {
    throw new Error('expected an expression statement');
  }
  return statement.expression;
}

describe('unwrap', () => {
  it.each([
    ['parentheses', '(f);'],
    ['as', 'f as F;'],
    ['satisfies', 'f satisfies F;'],
    ['a non-null assertion', 'f!;'],
    ['a type assertion', '<F>f;'],
    ['an instantiation expression', 'f<T>;'],
    ['nested wrappers', '((f<T>)! as F);'],
  ])('removes %s', (_, code) => {
    const node = unwrap(expressionOf(code));
    expect(node.type).toBe('Identifier');
  });

  it('reaches an arrow function behind an instantiation expression', () => {
    expect(unwrap(expressionOf('(<T,>() => 1)<number>;')).type).toBe('ArrowFunctionExpression');
  });
});
