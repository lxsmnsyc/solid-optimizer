/**
 * Which modules use each export of the app, read from the files on disk.
 *
 * A component copied into the module that uses it is only smaller overall
 * when the original goes away, which takes that module being its only user.
 * The index answers that from the whole module graph, so it does not depend
 * on the order the bundler transforms modules in, and a server build and its
 * client build make the same decisions.
 *
 * Anything the index cannot follow counts as another use: a re-export, a
 * dynamic import, a namespace used as a value, or a use inside the module
 * that declares the export.
 */
import type { Node, Program } from 'oxc-parser';
import { collectParents, forEachChild, parse } from '../ast';
import type { Parents } from '../ast';
import type { Binding, ScopeAnalysis } from '../scope';
import { analyzeScopes } from '../scope';

export interface UsageIndex {
  /**
   * Whether `user` is the only module that uses `exportName` of `module`,
   * and only as JSX tags. `absorbed` holds, by module, the exported
   * components that were copied into `user` and leave their module, so the
   * uses inside them count as uses in `user`.
   */
  isOnlyUser(
    module: string,
    exportName: string,
    user: string,
    absorbed: ReadonlyMap<string, ReadonlySet<string>>,
  ): boolean;
}

export interface UsageHost {
  /** The id `source` resolves to from `importer`, or `undefined` outside the app. */
  resolve(source: string, importer: string): Promise<string | undefined>;
  /** The code of a module, or `undefined` when it cannot be read. */
  read(id: string): Promise<string | undefined>;
}

/** The name a use counts under when it is not inside an exported declaration. */
const UNEXPORTED = '';

interface ExportUsage {
  /**
   * The modules that use the export as a JSX tag, each with the export
   * names of the top-level declarations the uses sit in.
   */
  readonly importers: Map<string, Set<string>>;
  /** Whether anything uses it other than as a tag. */
  other: boolean;
}

const SCRIPT = /\.[mc]?[jt]sx?$/;

class Usage implements UsageIndex {
  private readonly exports = new Map<string, ExportUsage>();

  /** Modules any of whose exports can be used in a way the index does not follow. */
  private readonly opaque = new Set<string>();

  private entry(module: string, name: string): ExportUsage {
    const key = `${module}\0${name}`;
    let usage = this.exports.get(key);
    if (!usage) {
      usage = { importers: new Map(), other: false };
      this.exports.set(key, usage);
    }
    return usage;
  }

  tag(module: string, name: string, importer: string, containers: readonly string[]): void {
    const { importers } = this.entry(module, name);
    const known = importers.get(importer) ?? new Set();
    for (const container of containers) {
      known.add(container);
    }
    importers.set(importer, known);
  }

  other(module: string, name: string): void {
    this.entry(module, name).other = true;
  }

  all(module: string): void {
    this.opaque.add(module);
  }

  isOnlyUser(
    module: string,
    exportName: string,
    user: string,
    absorbed: ReadonlyMap<string, ReadonlySet<string>>,
  ): boolean {
    if (this.opaque.has(module)) {
      return false;
    }
    const usage = this.exports.get(`${module}\0${exportName}`);
    if (!usage || usage.other || usage.importers.size === 0) {
      return false;
    }
    for (const [importer, containers] of usage.importers) {
      const moved = absorbed.get(importer);
      if (importer !== user && ![...containers].every((name) => moved?.has(name) === true)) {
        return false;
      }
    }
    return true;
  }
}

function isTagName(reference: Node, parents: Parents): boolean {
  const parent = parents.get(reference);
  return parent?.type === 'JSXOpeningElement' && parent.name === reference;
}

function isClosingTagName(reference: Node, parents: Parents): boolean {
  const parent = parents.get(reference);
  return parent?.type === 'JSXClosingElement' && parent.name === reference;
}

/** The names a declaration exported with `export` declares. */
function declaredNames(declaration: Node | null | undefined): string[] {
  if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
    return [declaration.id.name];
  }
  if (declaration?.type === 'VariableDeclaration') {
    return declaration.declarations.flatMap((declarator) =>
      declarator.id.type === 'Identifier' ? [declarator.id.name] : [],
    );
  }
  return [];
}

/** The top-level bindings a module exports, each with its export names. */
function exportedBindings(program: Program, scopes: ScopeAnalysis): Map<Binding, string[]> {
  const exported = new Map<Binding, string[]>();
  const add = (local: string, name: string): void => {
    const binding = scopes.root.bindings.get(local);
    if (binding) {
      exported.set(binding, [...(exported.get(binding) ?? []), name]);
    }
  };
  for (const statement of program.body) {
    if (statement.type === 'ExportNamedDeclaration' && !statement.source) {
      for (const name of declaredNames(statement.declaration)) {
        add(name, name);
      }
      for (const specifier of statement.specifiers) {
        if (specifier.local.type === 'Identifier') {
          add(
            specifier.local.name,
            specifier.exported.type === 'Identifier'
              ? specifier.exported.name
              : specifier.exported.value,
          );
        }
      }
    } else if (statement.type === 'ExportDefaultDeclaration') {
      const { declaration } = statement;
      if (declaration.type === 'FunctionDeclaration' && declaration.id) {
        add(declaration.id.name, 'default');
      } else if (declaration.type === 'Identifier') {
        add(declaration.name, 'default');
      }
    }
  }
  return exported;
}

/**
 * Records how a module uses what it imports, and the uses of its own
 * exports inside it.
 */
function recordModule(
  usage: Usage,
  id: string,
  program: Program,
  targets: ReadonlyMap<string, string>,
): void {
  const scopes = analyzeScopes(program);
  const parents = collectParents(program);

  // A module that uses its own export keeps it, whoever else copies it.
  const exported = exportedBindings(program, scopes);
  // The export names of the top-level declaration a use sits in.
  const containersOf = (reference: Node): string[] => {
    let node: Node = reference;
    let parent = parents.get(node);
    while (parent && parent.type !== 'Program') {
      node = parent;
      parent = parents.get(node);
    }
    const declaration =
      (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') &&
      node.declaration
        ? node.declaration
        : node;
    const bindings: (Binding | undefined)[] = [];
    if (declaration.type === 'FunctionDeclaration' && declaration.id) {
      bindings.push(scopes.root.bindings.get(declaration.id.name));
    } else if (declaration.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (
          declarator.id.type === 'Identifier' &&
          reference.start >= declarator.start &&
          reference.end <= declarator.end
        ) {
          bindings.push(scopes.root.bindings.get(declarator.id.name));
        }
      }
    }
    const names = bindings.flatMap((binding) => (binding ? (exported.get(binding) ?? []) : []));
    return names.length > 0 ? names : [UNEXPORTED];
  };

  const record = (binding: Binding, target: string): void => {
    const imported = binding.imported ?? '*';
    for (const reference of binding.references) {
      if (isClosingTagName(reference, parents)) {
        continue;
      }
      if (imported !== '*') {
        if (isTagName(reference, parents)) {
          usage.tag(target, imported, id, containersOf(reference));
        } else {
          usage.other(target, imported);
        }
        continue;
      }
      // `<Ns.Member>` and `Ns.member` use one export. Anything else may use any.
      const member = parents.get(reference);
      if (member?.type === 'JSXMemberExpression' && member.object === reference) {
        if (isTagName(member, parents)) {
          usage.tag(target, member.property.name, id, containersOf(reference));
        } else {
          usage.other(target, member.property.name);
        }
      } else if (
        member?.type === 'MemberExpression' &&
        member.object === reference &&
        !member.computed &&
        member.property.type === 'Identifier'
      ) {
        usage.other(target, member.property.name);
      } else {
        usage.all(target);
      }
    }
  };
  for (const binding of scopes.root.bindings.values()) {
    if (binding.kind === 'import' && binding.source !== undefined) {
      const target = targets.get(binding.source);
      if (target !== undefined) {
        record(binding, target);
      }
    }
  }

  // Re-exports pass an export on, which the index does not follow.
  for (const statement of program.body) {
    if (statement.type === 'ExportAllDeclaration') {
      const target = targets.get(statement.source.value);
      if (target !== undefined) {
        usage.all(target);
      }
    } else if (statement.type === 'ExportNamedDeclaration' && statement.source) {
      const target = targets.get(statement.source.value);
      for (const specifier of statement.specifiers) {
        const name =
          specifier.local.type === 'Identifier' ? specifier.local.name : specifier.local.value;
        if (target !== undefined) {
          usage.other(target, name);
        }
      }
    }
  }

  for (const [binding, names] of exported) {
    const used = binding.references.some((reference) => {
      const parent = parents.get(reference);
      return (
        parent?.type !== 'ExportSpecifier' &&
        parent?.type !== 'ExportDefaultDeclaration' &&
        !isClosingTagName(reference, parents)
      );
    });
    if (used) {
      for (const name of names) {
        usage.other(id, name);
      }
    }
  }
}

/** The import specifiers a module loads, statically or with `import()`. */
function specifiersOf(program: Program): { static: Set<string>; dynamic: Set<string> } {
  const statics = new Set<string>();
  const dynamics = new Set<string>();
  for (const statement of program.body) {
    if (
      (statement.type === 'ImportDeclaration' && statement.importKind !== 'type') ||
      ((statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportAllDeclaration') &&
        statement.source &&
        statement.exportKind !== 'type')
    ) {
      const value = statement.source?.value;
      if (value !== undefined) {
        statics.add(value);
      }
    }
  }
  const visit = (node: Node): void => {
    if (
      node.type === 'ImportExpression' &&
      node.source.type === 'Literal' &&
      typeof node.source.value === 'string'
    ) {
      dynamics.add(node.source.value);
    }
    forEachChild(node, visit);
  };
  visit(program);
  return { static: statics, dynamic: dynamics };
}

/**
 * Reads every module reachable from `entries` and records how each export
 * is used.
 */
export async function buildUsageIndex(
  entries: readonly string[],
  host: UsageHost,
): Promise<UsageIndex> {
  const usage = new Usage();
  // An entry's exports are its public API.
  for (const entry of entries) {
    usage.all(entry);
  }
  const seen = new Set<string>();
  let frontier = entries.filter((id) => SCRIPT.test(id.replace(/\?.*$/, '')));
  while (frontier.length > 0) {
    for (const id of frontier) {
      seen.add(id);
    }
    // oxlint-disable-next-line no-await-in-loop
    const next = await Promise.all(
      frontier.map(async (id) => {
        const code = await host.read(id);
        let program: Program;
        try {
          program = parse(id.replace(/\?.*$/, ''), code ?? '');
        } catch {
          return [];
        }
        const { static: statics, dynamic } = specifiersOf(program);
        const targets = new Map<string, string>();
        await Promise.all(
          [...statics, ...dynamic].map(async (source) => {
            const target = await host.resolve(source, id);
            if (target !== undefined) {
              targets.set(source, target);
            }
          }),
        );
        // A module loaded with `import()` is used as a whole.
        for (const source of dynamic) {
          const target = targets.get(source);
          if (target !== undefined) {
            usage.all(target);
          }
        }
        recordModule(usage, id, program, targets);
        return [...targets.values()];
      }),
    );
    frontier = [...new Set(next.flat())].filter(
      (id) => !seen.has(id) && SCRIPT.test(id.replace(/\?.*$/, '')),
    );
  }
  return usage;
}
