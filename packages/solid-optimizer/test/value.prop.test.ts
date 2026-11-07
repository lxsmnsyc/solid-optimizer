/**
 * Generated tests for the constant lattice, with the engine as the oracle.
 * Every expression here is made of primitives only, so running its source
 * gives the value a fold must produce.
 */
import { fc, test } from '@fast-check/vitest';
import { runInThisContext } from 'node:vm';
import type { ExpressionStatement } from 'oxc-parser';
import { expect } from 'vitest';
import './fc';
import { parse } from '../src/ast';
import type { Primitive } from '../src/value';
import { evaluate, literalText, truthiness } from '../src/value';

const BINARY = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '===',
  '!==',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '&',
  '|',
  '^',
  '<<',
  '>>',
  '>>>',
];
const LOGICAL = ['&&', '||', '??'];
const UNARY = ['!', 'typeof ', '+', '-', '~', 'void '];

// Strings that coerce in interesting ways, plus any short string.
const text = fc.oneof(
  fc.constantFrom(
    '',
    ' ',
    '0',
    '1',
    '-1',
    '1e3',
    '0x10',
    'NaN',
    'Infinity',
    'abc',
    '\n',
    '`',
    '${',
    '\\',
  ),
  fc.string({ maxLength: 4 }),
);

// Values that coerce into each other, so loose equality and comparisons meet equal pairs often.
const coercible = fc.constantFrom(
  'true',
  'false',
  'null',
  '(void 0)',
  '0',
  '1',
  '(-0)',
  '(0 / 0)',
  '""',
  '" "',
  '"0"',
  '"1"',
  '"a"',
);

const literal = fc.oneof(
  { arbitrary: coercible, weight: 4 },
  fc.constantFrom('2', '0.5', '1e21', '0x1f', '1_000', '.5'),
  // Negatives, NaN and the infinities only come from operators.
  fc.constantFrom('(-1)', '(-2.5)', '(-(2 ** 31))', '(2 ** 32)', '(1 / 0)', '(-1 / 0)'),
  fc.integer({ min: 0, max: 2 ** 40 }).map(String),
  fc.double({ min: 0, noNaN: true, noDefaultInfinity: true }).map((value) => String(value)),
  text.map((value) => JSON.stringify(value)),
  text.map(
    (value) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`,
  ),
);

// `?? ` cannot mix with `&&` or `||` without parentheses, so every compound part is wrapped.
const { expression } = fc.letrec<{ expression: string }>((tie) => ({
  expression: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    literal,
    fc.tuple(fc.constantFrom(...UNARY), tie('expression')).map(([op, a]) => `${op}(${a})`),
    fc
      .tuple(tie('expression'), fc.constantFrom(...BINARY, ...LOGICAL), tie('expression'))
      .map(([a, op, b]) => `(${a}) ${op} (${b})`),
    fc
      .tuple(tie('expression'), tie('expression'), tie('expression'))
      .map(([a, b, c]) => `(${a}) ? (${b}) : (${c})`),
    fc
      .tuple(fc.string({ maxLength: 3 }), tie('expression'), fc.string({ maxLength: 3 }))
      .map(
        ([head, middle, tail]) => `\`${escapeTemplate(head)}\${${middle}}${escapeTemplate(tail)}\``,
      ),
  ),
}));

function escapeTemplate(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
}

function parseExpression(source: string): ExpressionStatement['expression'] {
  const statement = parse('input.js', `(${source});`).body.at(0);
  if (statement?.type !== 'ExpressionStatement') {
    throw new Error(`not an expression: ${source}`);
  }
  return statement.expression;
}

function isPrimitive(value: unknown): value is Primitive {
  return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

/** What the engine gives for `source`, which holds only primitives and operators. */
function run(source: string): Primitive {
  const value: unknown = runInThisContext(`(${source})`);
  if (!isPrimitive(value)) {
    throw new Error(`not a primitive: ${source}`);
  }
  return value;
}

function noLookup(): undefined {
  return undefined;
}

test.prop([expression])('evaluate agrees with the engine', (source) => {
  const folded = evaluate(parseExpression(source), noLookup);
  expect(folded).toBeDefined();
  expect(
    Object.is(folded?.value, run(source)),
    `${source} folded to ${String(folded?.value)}`,
  ).toBe(true);
});

// One property per operator, so each one meets 100 pairs of operands. A
// third of the pairs repeat one operand, which equal-value cases need.
for (const operator of [...BINARY, ...LOGICAL]) {
  const pair = fc.oneof(
    { arbitrary: fc.tuple(literal, literal), weight: 2 },
    literal.map((a) => [a, a] as const),
  );
  test.prop([pair])(`evaluate agrees with the engine on ${operator}`, ([a, b]) => {
    const source = `${a} ${operator} ${b}`;
    expect(Object.is(evaluate(parseExpression(source), noLookup)?.value, run(source)), source).toBe(
      true,
    );
  });
}

for (const operator of UNARY) {
  test.prop([literal])(`evaluate agrees with the engine on ${operator.trim()}`, (a) => {
    const source = `${operator}${a}`;
    expect(Object.is(evaluate(parseExpression(source), noLookup)?.value, run(source)), source).toBe(
      true,
    );
  });
}

test.prop([expression])('truthiness agrees with the engine', (source) => {
  expect(truthiness(parseExpression(source), noLookup)).toBe(!!run(source));
});

const primitive = fc.oneof(
  fc.string(),
  fc.double(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
);

test.prop([primitive])('literalText runs back to the same value', (value) => {
  const source = literalText(value);
  if (source === undefined) {
    // Only values with no literal spelling are left out.
    expect(
      value === undefined ||
        (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0))),
    ).toBe(true);
    return;
  }
  expect(Object.is(run(source), value)).toBe(true);
  expect(Object.is(evaluate(parseExpression(source), noLookup)?.value, value)).toBe(true);
});
