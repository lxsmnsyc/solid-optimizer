/**
 * Constants bindings resolve to, within a module and across its imports.
 *
 * A module only sees its own code, so the values its imports resolve to come
 * from `importedConstants`, which a caller fills with `constantExports` of
 * each imported module.
 */
import type { MemberExpression, Node, Program } from 'oxc-parser';
import type { ResolvedOptions } from './context';
import { isConstantDeclaration } from './context';
import type { Binding, ScopeAnalysis } from './scope';
import { analyzeScopes } from './scope';
import type { Const, ConstantLookup, Primitive } from './value';
import { evaluate } from './value';

/**
 * The constants each imported module exports, keyed by the import specifier
 * as the module writes it, then by export name.
 */
export type ImportedConstants = Readonly<Record<string, Readonly<Record<string, Primitive>>>>;

export type ResolvedImportedConstants = ReadonlyMap<string, ReadonlyMap<string, Const>>;

export function resolveImportedConstants(
  constants: ImportedConstants | undefined,
): ResolvedImportedConstants {
  const result = new Map<string, Map<string, Const>>();
  for (const [source, exports] of Object.entries(constants ?? {})) {
    result.set(source, new Map(Object.entries(exports).map(([name, value]) => [name, { value }])));
  }
  return result;
}

function globalValue(name: string): Const | undefined {
  switch (name) {
    case 'undefined':
      return { value: undefined };
    case 'NaN':
      return { value: Number.NaN };
    case 'Infinity':
      return { value: Number.POSITIVE_INFINITY };
    default:
      return undefined;
  }
}

/**
 * Resolves identifier references to constants, caching each binding.
 */
export class ConstantTable {
  readonly lookup: ConstantLookup;

  private readonly constants = new Map<Binding, Const | null>();

  private readonly evaluating = new Set<Binding>();

  constructor(
    scopes: ScopeAnalysis,
    private readonly options: ResolvedOptions,
  ) {
    this.lookup = (reference) => {
      if (reference.type === 'MemberExpression') {
        return this.namespaceMember(scopes, reference);
      }
      if (!scopes.references.has(reference) || reference.type !== 'Identifier') {
        return undefined;
      }
      const binding = scopes.references.get(reference);
      return binding ? this.constantOf(binding) : globalValue(reference.name);
    };
  }

  /**
   * The value of `ns.NAME`, where `ns` is `import * as ns` from a module
   * whose constants are known.
   */
  private namespaceMember(scopes: ScopeAnalysis, node: MemberExpression): Const | undefined {
    const { object, property } = node;
    if (object.type !== 'Identifier' || node.optional) {
      return undefined;
    }
    const binding = scopes.references.get(object);
    if (binding?.kind !== 'import' || binding.imported !== '*' || binding.source === undefined) {
      return undefined;
    }
    let name: string | undefined;
    if (!node.computed && property.type === 'Identifier') {
      name = property.name;
    } else if (node.computed && property.type === 'Literal' && typeof property.value === 'string') {
      name = property.value;
    }
    return name === undefined
      ? undefined
      : this.options.importedConstants.get(binding.source)?.get(name);
  }

  /**
   * The value of a `const`, of a `let` nothing writes to, or of an import
   * whose module exports a known constant.
   *
   * A reference that runs before its declaration throws at runtime, and
   * folding turns it into the value. Minifiers make the same trade.
   */
  constantOf(binding: Binding): Const | undefined {
    const cached = this.constants.get(binding);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    let value: Const | undefined;
    const { declaration } = binding;
    if (binding.kind === 'import') {
      if (binding.source !== undefined && binding.imported !== undefined) {
        value = this.options.importedConstants.get(binding.source)?.get(binding.imported);
      }
    } else if (
      isConstantDeclaration(binding, this.options) &&
      declaration.type === 'VariableDeclarator' &&
      declaration.id === binding.identifier &&
      declaration.init &&
      !this.evaluating.has(binding)
    ) {
      this.evaluating.add(binding);
      value = evaluate(declaration.init, this.lookup);
      this.evaluating.delete(binding);
    }
    this.constants.set(binding, value ?? null);
    return value;
  }
}

/**
 * The modules `program` imports or re-exports bindings from. Their
 * constant exports are what `importedConstants` can hold.
 */
export function namedImportSources(program: Program): string[] {
  const sources = new Set<string>();
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration') {
      if (
        statement.importKind !== 'type' &&
        statement.specifiers.some(
          (specifier) => !(specifier.type === 'ImportSpecifier' && specifier.importKind === 'type'),
        )
      ) {
        sources.add(statement.source.value);
      }
    } else if (
      (statement.type === 'ExportNamedDeclaration' && statement.source) ||
      (statement.type === 'ExportAllDeclaration' && !statement.exported)
    ) {
      if (statement.exportKind !== 'type' && statement.source) {
        sources.add(statement.source.value);
      }
    }
  }
  return [...sources];
}

function exportName(node: Node): string | undefined {
  if (node.type === 'Identifier') {
    return node.name;
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  return undefined;
}

/**
 * The constants a module exports: `export const` bindings whose value folds,
 * and names exported from such a binding, or re-exported from a module in
 * `importedConstants`.
 *
 * A `let` counts when the module never writes to it, since nothing else can.
 */
export function constantExports(
  program: Program,
  options: ResolvedOptions,
  scopes: ScopeAnalysis = analyzeScopes(program),
): Record<string, Primitive> {
  const table = new ConstantTable(scopes, options);
  const topLevel = scopes.root;
  const result: Record<string, Primitive> = {};
  const add = (name: string | undefined, value: Const | undefined): void => {
    if (name !== undefined && value) {
      result[name] = value.value;
    }
  };
  const starSources: string[] = [];
  for (const statement of program.body) {
    if (statement.type === 'ExportDefaultDeclaration') {
      const { declaration } = statement;
      if (declaration.type !== 'FunctionDeclaration' && declaration.type !== 'ClassDeclaration') {
        add('default', evaluate(declaration, table.lookup));
      }
      continue;
    }
    if (statement.type === 'ExportAllDeclaration') {
      if (!statement.exported && statement.exportKind !== 'type') {
        starSources.push(statement.source.value);
      }
      continue;
    }
    if (statement.type !== 'ExportNamedDeclaration' || statement.exportKind === 'type') {
      continue;
    }
    const { declaration } = statement;
    if (declaration?.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === 'Identifier') {
          const binding = topLevel.bindings.get(declarator.id.name);
          add(declarator.id.name, binding ? table.constantOf(binding) : undefined);
        }
      }
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.exportKind === 'type') {
        continue;
      }
      const local = exportName(specifier.local);
      const exported = exportName(specifier.exported);
      if (local === undefined) {
        continue;
      }
      if (statement.source) {
        add(exported, options.importedConstants.get(statement.source.value)?.get(local));
      } else {
        const binding = topLevel.bindings.get(local);
        add(exported, binding ? table.constantOf(binding) : undefined);
      }
    }
  }
  // `export *` never re-exports `default`, and loses to a name the module
  // exports itself. A name two of them export is ambiguous, so neither counts.
  const explicit = new Set(Object.keys(result));
  const starred = new Map<string, Const | null>();
  for (const source of starSources) {
    for (const [name, value] of options.importedConstants.get(source) ?? []) {
      if (name !== 'default' && !explicit.has(name)) {
        starred.set(name, starred.has(name) ? null : value);
      }
    }
  }
  for (const [name, value] of starred) {
    add(name, value ?? undefined);
  }
  return result;
}
