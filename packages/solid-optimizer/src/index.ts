import type { NodePath, PluginObj, PluginPass } from '@babel/core';
import * as t from '@babel/types';
import unwrapNode from './unwrap-node';

const TRACKED: Record<string, Record<string, boolean>> = {
  'solid-js': {
    createEffect: true,
    onMount: true,
    getListener: true,
    untrack: true,
    batch: true,
    startTransition: true,
    createDeferred: true,
  },
  'solid-js/web': {
    createEffect: true,
    onMount: true,
    getListener: true,
    untrack: true,
    batch: true,
    startTransition: true,
    createDeferred: true,
  },
};

const MODULES = new Set(Object.keys(TRACKED));

interface StateContext {
  identifiers: Record<string, Record<string, Set<t.Identifier>>>;
  namespaces: Record<string, Set<t.Identifier>>;
}

function isValidSpecifier(specifier: t.ImportSpecifier, name: string): boolean {
  return (
    (t.isIdentifier(specifier.imported) && specifier.imported.name === name) ||
    (t.isStringLiteral(specifier.imported) && specifier.imported.value === name)
  );
}

function extractImportIdentifiers(
  ctx: StateContext,
  path: NodePath<t.ImportDeclaration>,
): void {
  if (!MODULES.has(path.node.source.value)) {
    return;
  }
  const modulePath = path.node.source.value;
  for (let i = 0, len = path.node.specifiers.length; i < len; i += 1) {
    const specifier = path.node.specifiers[i];
    if (t.isImportSpecifier(specifier)) {
      const ids = TRACKED[modulePath];

      for (const key of Object.keys(ids)) {
        if (isValidSpecifier(specifier, key)) {
          ctx.identifiers[modulePath][key].add(specifier.local);
        }
      }
    } else if (t.isImportNamespaceSpecifier(specifier)) {
      ctx.namespaces[modulePath].add(specifier.local);
    }
  }
}

function checkValidIdentifierImport(
  ctx: StateContext,
  identifier: t.Identifier,
): string | undefined {
  for (const mod of MODULES) {
    const identifiers = ctx.identifiers[mod];
    for (const key of Object.keys(identifiers)) {
      if (identifiers[key].has(identifier)) {
        return key;
      }
    }
  }
  return undefined;
}

function checkValidNamespaceImport(
  ctx: StateContext,
  object: t.Identifier,
  property: string,
): boolean {
  for (const mod of MODULES) {
    const namespace = ctx.namespaces[mod];
    if (namespace.has(object) && property in TRACKED[mod]) {
      return true;
    }
  }
  return false;
}

function transformCreateEffect(path: NodePath<t.CallExpression>): void {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/reactive.ts#L78
  // Just remove it
  path.remove();
}

function transformOnMount(path: NodePath<t.CallExpression>): void {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/reactive.ts#L131
  // Just remove it
  path.remove();
}

function transformGetListener(path: NodePath<t.CallExpression>): void {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/reactive.ts#L157
  path.replaceWith(t.nullLiteral());
}

function transformBatch(path: NodePath<t.CallExpression>): void {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/reactive.ts#L107
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

function transformUntrack(path: NodePath<t.CallExpression>): void {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/reactive.ts#L111
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

interface State extends PluginPass {
  ctx: StateContext;
}

function runTransform(
  path: NodePath<t.CallExpression>,
  targetName: string,
): void {
  switch (targetName) {
    case 'createEffect': {
      transformCreateEffect(path);
      break;
    }
    case 'onMount': {
      transformOnMount(path);
      break;
    }
    case 'getListener': {
      transformGetListener(path);
      break;
    }
    case 'untrack': {
      transformUntrack(path);
      break;
    }
    case 'batch': {
      transformBatch(path);
      break;
    }
    case 'startTransition': {
      transformStartTransition(path);
      break;
    }
    case 'createDeferred': {
      transformCreateDeferred(path);
      break;
    }
  }
}

function transformCallExpression(
  ctx: StateContext,
  path: NodePath<t.CallExpression>,
): void {
  const trueIdentifier = unwrapNode(path.node.callee, t.isIdentifier);
  if (trueIdentifier) {
    const binding = path.scope.getBindingIdentifier(trueIdentifier.name);
    if (binding) {
      const targetName = checkValidIdentifierImport(ctx, binding);
      if (targetName) {
        runTransform(path, targetName);
      }
    }
    return;
  }
  const trueMemberExpr = unwrapNode(path.node.callee, t.isMemberExpression);
  if (
    trueMemberExpr &&
    t.isIdentifier(trueMemberExpr.property) &&
    !trueMemberExpr.computed
  ) {
    const source = unwrapNode(trueMemberExpr.object, t.isIdentifier);
    if (source) {
      const targetName = trueMemberExpr.property.name;
      const binding = path.scope.getBindingIdentifier(source.name);
      if (binding && checkValidNamespaceImport(ctx, binding, targetName)) {
        runTransform(path, targetName);
      }
    }
  }
}

export default function solidOptimizerPlugin(): PluginObj<State> {
  return {
    name: 'solid-optimizer',
    visitor: {
      Program(program) {
        const ctx: StateContext = {
          identifiers: {
            'solid-js': {
              createEffect: new Set(),
              onMount: new Set(),
              getListener: new Set(),
              untrack: new Set(),
              batch: new Set(),
              startTransition: new Set(),
              createDeferred: new Set(),
            },
            'solid-js/web': {
              createEffect: new Set(),
              onMount: new Set(),
              getListener: new Set(),
              untrack: new Set(),
              batch: new Set(),
              startTransition: new Set(),
              createDeferred: new Set(),
            },
          },
          namespaces: {
            'solid-js': new Set(),
            'solid-js/web': new Set(),
          },
        };
        program.traverse({
          ImportDeclaration(path): void {
            extractImportIdentifiers(ctx, path);
          },
        });
        program.traverse({
          CallExpression(path): void {
            transformCallExpression(ctx, path);
          },
        });
      },
    },
  };
}
