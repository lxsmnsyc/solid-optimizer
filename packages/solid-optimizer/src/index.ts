import { NodePath, PluginObj, PluginPass } from '@babel/core';
import * as t from '@babel/types';

const TRACKED: Record<string, Record<string, boolean>> = {
  'solid-js': {
    createEffect: true,
    onMount: true,
    getListener: true,
    untrack: true,
    batch: true,
    createDeferred: true,
  },
};

const MODULES = new Set(Object.keys(TRACKED));

interface StateContext {
  hooks: Map<string, t.Identifier>;
  identifiers: Record<string, Record<string, Set<t.Identifier>>>;
  namespaces: Record<string, Set<t.Identifier>>;
}

function isValidSpecifier(
  specifier: t.ImportSpecifier,
  name: string,
): boolean {
  return (
    (t.isIdentifier(specifier.imported) && specifier.imported.name === name)
    || (t.isStringLiteral(specifier.imported) && specifier.imported.value === name)
  );
}

function extractImportIdentifiers(
  ctx: StateContext,
  path: NodePath<t.ImportDeclaration>,
) {
  if (MODULES.has(path.node.source.value)) {
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
}

function checkValidIdentifierImport(
  ctx: StateContext,
  identifier: t.Identifier,
) {
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
) {
  for (const mod of MODULES) {
    const namespace = ctx.namespaces[mod];
    if (namespace.has(object) && property in TRACKED[mod]) {
      return true;
    }
  }
  return false;
}

function transformCreateEffect(
  path: NodePath<t.CallExpression>,
) {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/reactive.ts#L78
  // Just remove it
  path.remove();
}

function transformOnMount(
  path: NodePath<t.CallExpression>,
) {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/reactive.ts#L131
  // Just remove it
  path.remove();
}

function transformGetListener(
  path: NodePath<t.CallExpression>,
) {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/reactive.ts#L157
  path.replaceWith(t.nullLiteral());
}

function transformBatch(
  path: NodePath<t.CallExpression>,
) {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/reactive.ts#L107
  const arg = path.node.arguments[0];
  if (t.isExpression(arg)) {
    if (t.isArrowFunctionExpression(arg) && t.isExpression(arg.body)) {
      path.replaceWith(arg.body);
    } else {
      path.replaceWith(t.callExpression(arg, []));
    }
  } else if (t.isSpreadElement(arg)) {
    path.replaceWith(
      t.callExpression(
        t.memberExpression(
          arg.argument,
          t.numericLiteral(0),
          true,
        ),
        [],
      ),
    );
  }
}

function transformUntrack(
  path: NodePath<t.CallExpression>,
) {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/reactive.ts#L111
  const arg = path.node.arguments[0];
  if (t.isExpression(arg)) {
    if (t.isArrowFunctionExpression(arg) && t.isExpression(arg.body)) {
      path.replaceWith(arg.body);
    } else {
      path.replaceWith(t.callExpression(arg, []));
    }
  } else if (t.isSpreadElement(arg)) {
    path.replaceWith(
      t.callExpression(
        t.memberExpression(
          arg.argument,
          t.numericLiteral(0),
          true,
        ),
        [],
      ),
    );
  }
}

function transformCreateDeferred(
  path: NodePath<t.CallExpression>,
) {
  // https://github.com/solidjs/solid/blob/main/packages/solid/src/server/reactive.ts#L99
  const arg = path.node.arguments[0];
  if (t.isExpression(arg)) {
    path.replaceWith(arg);
  } else if (t.isSpreadElement(arg)) {
    path.replaceWith(
      t.memberExpression(
        arg.argument,
        t.numericLiteral(0),
        true,
      ),
    );
  }
}

interface State extends PluginPass {
  ctx: StateContext;
}

function runTransform(path: NodePath<t.CallExpression>, targetName: string) {
  switch (targetName) {
    case 'createEffect':
      transformCreateEffect(path);
      break;
    case 'onMount':
      transformOnMount(path);
      break;
    case 'getListener':
      transformGetListener(path);
      break;
    case 'untrack':
      transformUntrack(path);
      break;
    case 'batch':
      transformBatch(path);
      break;
    case 'createDeferred':
      transformCreateDeferred(path);
      break;
    default:
      break;
  }
}

export default function solidOptimizerPlugin(): PluginObj<State> {
  return {
    name: 'solid-optimizer',
    pre() {
      this.ctx = {
        hooks: new Map(),
        identifiers: {
          'solid-js': {
            createEffect: new Set(),
            onMount: new Set(),
            getListener: new Set(),
            untrack: new Set(),
            batch: new Set(),
            createDeferred: new Set(),
          },
        },
        namespaces: {
          'solid-js': new Set(),
        },
      };
    },
    visitor: {
      ImportDeclaration(path, state) {
        extractImportIdentifiers(state.ctx, path);
      },
      CallExpression(path, state) {
        const { callee } = path.node;
        if (t.isIdentifier(callee)) {
          const binding = path.scope.getBindingIdentifier(callee.name);
          if (binding) {
            const targetName = checkValidIdentifierImport(state.ctx, binding);
            if (targetName) {
              runTransform(path, targetName);
            }
          }
        } else if (
          t.isMemberExpression(callee)
          && t.isIdentifier(callee.object)
          && t.isIdentifier(callee.property)
          && !callee.computed
        ) {
          const targetName = callee.property.name;
          const binding = path.scope.getBindingIdentifier(callee.object.name);
          if (binding && checkValidNamespaceImport(state.ctx, binding, targetName)) {
            runTransform(path, targetName);
          }
        }
      },
    },
  };
}
