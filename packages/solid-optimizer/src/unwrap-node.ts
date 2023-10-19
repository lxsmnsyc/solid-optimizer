import * as t from '@babel/types';

type TypeCheck<K> =
  K extends (node: t.Node) => node is (infer U extends t.Node)
    ? U
    : never;

type TypeFilter = (node: t.Node) => boolean;

export default function unwrapNode<K extends TypeFilter>(
  node: t.Node,
  key: K,
): TypeCheck<K> | undefined {
  if (key(node)) {
    return node as TypeCheck<K>;
  }
  switch (node.type) {
    case 'ParenthesizedExpression':
    case 'TypeCastExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'TSTypeAssertion':
    case 'TSInstantiationExpression':
      return unwrapNode(node.expression, key);
    default:
      return undefined;
  }
}
