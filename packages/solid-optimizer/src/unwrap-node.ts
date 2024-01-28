import type * as t from '@babel/types';

type BroadTypeFilter<K extends t.Node> = (node: t.Node) => node is K;
type TypeCheck<K> = K extends BroadTypeFilter<infer U> ? U : never;

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
