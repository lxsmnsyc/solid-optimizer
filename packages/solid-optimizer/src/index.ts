import type { NodePath, PluginObj } from '@babel/core';
import * as t from '@babel/types';
import { pathReferencesImport } from './path-references-import';
import unwrapNode from './unwrap-node';

function transformUntrackAndBatch(path: NodePath<t.CallExpression>): void {
  // https://github.com/solidjs/solid/blob/41fa6c14b4bf71eed593303cd63b32d53e3515e9/packages/solid/src/server/reactive.ts#L130-L134
  const arg = path.node.arguments[0];
  if (t.isExpression(arg)) {
    const trueArrow = unwrapNode(arg, t.isArrowFunctionExpression);
    if (trueArrow) {
      if (t.isExpression(trueArrow.body)) {
        path.replaceWith(trueArrow.body);
      } else {
        path.replaceWith(t.callExpression(trueArrow, []));
      }
      return;
    }
    const trueFunc = unwrapNode(arg, t.isFunctionExpression);
    if (trueFunc) {
      path.replaceWith(trueFunc.body);
    }
  } else if (t.isSpreadElement(arg)) {
    path.replaceWith(
      t.callExpression(
        t.memberExpression(arg.argument, t.numericLiteral(0), true),
        [],
      ),
    );
  }
}

function transformStartTransition(path: NodePath<t.CallExpression>): void {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/rendering.ts#L488
  const arg = path.node.arguments[0];
  if (t.isExpression(arg)) {
    const trueArrow = unwrapNode(arg, t.isArrowFunctionExpression);
    if (trueArrow) {
      if (t.isExpression(trueArrow.body)) {
        path.replaceWith(trueArrow.body);
      } else {
        path.replaceWith(t.callExpression(trueArrow, []));
      }
      return;
    }
    const trueFunc = unwrapNode(arg, t.isFunctionExpression);
    if (trueFunc) {
      path.replaceWith(trueFunc.body);
    }
  } else if (t.isSpreadElement(arg)) {
    path.replaceWith(
      t.callExpression(
        t.memberExpression(arg.argument, t.numericLiteral(0), true),
        [],
      ),
    );
  }
}

function transformCreateDeferred(path: NodePath<t.CallExpression>): void {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/reactive.ts#L99
  const arg = path.node.arguments[0];
  if (t.isExpression(arg)) {
    path.replaceWith(arg);
  } else if (t.isSpreadElement(arg)) {
    path.replaceWith(
      t.memberExpression(arg.argument, t.numericLiteral(0), true),
    );
  }
}

const MODULES = ['solid-js', 'solid-js/web'];

function transformCallExpression(path: NodePath<t.CallExpression>): void {
  const callee = path.get('callee');

  if (pathReferencesImport(callee, MODULES, ['createEffect', 'onMount'])) {
    // https://github.com/solidjs/solid/blob/41fa6c14b4bf71eed593303cd63b32d53e3515e9/packages/solid/src/server/reactive.ts#L101
    // https://github.com/solidjs/solid/blob/41fa6c14b4bf71eed593303cd63b32d53e3515e9/packages/solid/src/server/reactive.ts#L154
    // Just remove it
    path.remove();
  } else if (pathReferencesImport(callee, MODULES, ['getListener'])) {
    // https://github.com/solidjs/solid/blob/41fa6c14b4bf71eed593303cd63b32d53e3515e9/packages/solid/src/server/reactive.ts#L188
    path.replaceWith(t.nullLiteral());
  } else if (pathReferencesImport(callee, MODULES, ['untrack', 'batch'])) {
    transformUntrackAndBatch(path);
  } else if (pathReferencesImport(callee, MODULES, ['startTransition'])) {
    transformStartTransition(path);
  } else if (pathReferencesImport(callee, MODULES, ['createDeferred'])) {
    transformCreateDeferred(path);
  }
}

export default function solidOptimizerPlugin(): PluginObj {
  return {
    name: 'solid-optimizer',
    visitor: {
      Program(program) {
        program.traverse({
          CallExpression(path): void {
            transformCallExpression(path);
          },
        });
      },
    },
  };
}
