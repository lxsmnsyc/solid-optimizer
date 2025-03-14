import type { NodePath } from '@babel/core';
import * as t from '@babel/types';
import { isPathValid } from './checks';
import unwrapPath from './unwrap-path';

function pathReferencesImportIdentifier(
  path: NodePath,
  moduleSources: string[],
  importNames: string[],
): boolean {
  const identifier = unwrapPath(path, t.isIdentifier);
  if (!identifier) {
    return false;
  }
  const binding = path.scope.getBinding(identifier.node.name);
  if (!binding || binding.kind !== 'module') {
    return false;
  }
  const importPath = binding.path;
  const importParent = importPath.parentPath;
  if (
    isPathValid(importParent, t.isImportDeclaration) &&
    moduleSources.includes(importParent.node.source.value)
  ) {
    if (isPathValid(importPath, t.isImportSpecifier)) {
      const key = t.isIdentifier(importPath.node.imported)
        ? importPath.node.imported.name
        : importPath.node.imported.value;
      return importNames.includes(key);
    }
    if (isPathValid(importPath, t.isImportDefaultSpecifier)) {
      return importNames.includes('default');
    }
    if (isPathValid(importPath, t.isImportNamespaceSpecifier)) {
      return importNames.includes('*');
    }
  }
  return false;
}

const IMPORT_NAMESPACE = ['*'];

function pathReferencesImportMember(
  path: NodePath,
  moduleSources: string[],
  importNames: string[],
): boolean {
  const memberExpr =
    unwrapPath(path, t.isMemberExpression) ||
    unwrapPath(path, t.isOptionalMemberExpression);
  if (memberExpr) {
    const object = unwrapPath(memberExpr.get('object'), t.isIdentifier);
    if (!object) {
      return false;
    }
    const property = memberExpr.get('property');
    if (isPathValid(property, t.isIdentifier)) {
      return (
        importNames.includes(property.node.name) &&
        pathReferencesImport(object, moduleSources, IMPORT_NAMESPACE)
      );
    }
    if (isPathValid(property, t.isStringLiteral)) {
      return (
        importNames.includes(property.node.value) &&
        pathReferencesImport(object, moduleSources, IMPORT_NAMESPACE)
      );
    }
  }
  return false;
}

export function pathReferencesImport(
  path: NodePath,
  moduleSources: string[],
  importNames: string[],
): boolean {
  return (
    pathReferencesImportIdentifier(path, moduleSources, importNames) ||
    pathReferencesImportMember(path, moduleSources, importNames)
  );
}
