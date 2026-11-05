/**
 * Joins the REPL's files into one JSX chunk, the way a bundler with scope
 * hoisting would. solid-optimizer inlines across everything in a chunk, so
 * a component from one file can inline into another.
 *
 * Relative imports are resolved between the files. Each file's top-level
 * bindings keep their names, so two files cannot declare the same name.
 * Imports of other modules, like `solid-js`, move to the top of the chunk.
 */
import MagicString from 'magic-string';
import type { BindingPattern, Program, Statement } from 'oxc-parser';
import { parseSync } from 'oxc-parser';
import type { VirtualFile } from './protocol';

interface Module {
  file: VirtualFile;
  program: Program;
  /** The local name behind each export, keyed by export name. */
  exports: Map<string, string>;
}

export class BundleError extends Error {}

const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js'];

function isRelative(source: string): boolean {
  return source.startsWith('./') || source.startsWith('../');
}

function joinPath(importer: string, source: string): string {
  // Start from the importer's folder, then walk each segment of the source.
  const parts = importer.split('/');
  parts.pop();
  for (const segment of source.split('/')) {
    if (segment === '..') {
      parts.pop();
    } else if (segment !== '.' && segment !== '') {
      parts.push(segment);
    }
  }
  return parts.join('/');
}

function resolveFile(
  files: Map<string, VirtualFile>,
  importer: string,
  source: string,
): VirtualFile {
  const base = joinPath(importer, source);
  for (const extension of EXTENSIONS) {
    const file = files.get(base + extension);
    if (file) {
      return file;
    }
  }
  throw new BundleError(`${importer} imports "${source}", but there is no such file.`);
}

function parseFile(file: VirtualFile): Program {
  const result = parseSync(file.name, file.code, { sourceType: 'module' });
  if (result.errors.length > 0) {
    const [first] = result.errors;
    throw new BundleError(`${file.name}: ${first.message}`);
  }
  return result.program;
}

function collectPatternNames(pattern: BindingPattern, names: string[]): void {
  switch (pattern.type) {
    case 'Identifier':
      names.push(pattern.name);
      break;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        collectPatternNames(
          property.type === 'RestElement' ? property.argument : property.value,
          names,
        );
      }
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements) {
        if (element) {
          collectPatternNames(element.type === 'RestElement' ? element.argument : element, names);
        }
      }
      break;
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, names);
      break;
    default:
      break;
  }
}

/** The names a top-level statement declares, export or not. */
function collectDeclaredNames(statement: Statement, names: string[]): void {
  let node: Statement | null = statement;
  if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
    const { declaration } = node;
    node =
      declaration &&
      (declaration.type === 'FunctionDeclaration' ||
        declaration.type === 'ClassDeclaration' ||
        declaration.type === 'VariableDeclaration')
        ? declaration
        : null;
  }
  if (!node) {
    return;
  }
  if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
    names.push(node.id.name);
  } else if (node.type === 'VariableDeclaration') {
    for (const declarator of node.declarations) {
      collectPatternNames(declarator.id, names);
    }
  }
}

/** Orders the files the entry reaches so each comes after what it imports. */
function sortModules(files: Map<string, VirtualFile>, entry: VirtualFile): VirtualFile[] {
  const order: VirtualFile[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  function visit(file: VirtualFile, chain: string[]): void {
    const current = state.get(file.name);
    if (current === 'done') {
      return;
    }
    if (current === 'visiting') {
      throw new BundleError(`Import cycle: ${[...chain, file.name].join(' → ')}.`);
    }
    state.set(file.name, 'visiting');
    for (const statement of parseFile(file).body) {
      if (
        (statement.type === 'ImportDeclaration' ||
          statement.type === 'ExportAllDeclaration' ||
          (statement.type === 'ExportNamedDeclaration' && statement.source)) &&
        statement.source &&
        isRelative(statement.source.value)
      ) {
        visit(resolveFile(files, file.name, statement.source.value), [...chain, file.name]);
      }
    }
    state.set(file.name, 'done');
    order.push(file);
  }

  visit(entry, []);
  return order;
}

interface External {
  /** Imported name (`default`, `*`, or an export) by local name. */
  specifiers: Map<string, string>;
}

function printExternals(externals: Map<string, External>): string {
  const lines: string[] = [];
  for (const [source, { specifiers }] of externals) {
    const quoted = JSON.stringify(source);
    let defaultName: string | undefined;
    const named: string[] = [];
    for (const [local, imported] of specifiers) {
      if (imported === '*') {
        lines.push(`import * as ${local} from ${quoted};`);
      } else if (imported === 'default') {
        defaultName = local;
      } else {
        named.push(imported === local ? local : `${imported} as ${local}`);
      }
    }
    const clauses: string[] = [];
    if (defaultName) {
      clauses.push(defaultName);
    }
    if (named.length > 0) {
      clauses.push(`{ ${named.join(', ')} }`);
    }
    if (clauses.length > 0) {
      lines.push(`import ${clauses.join(', ')} from ${quoted};`);
    } else if (specifiers.size === 0) {
      lines.push(`import ${quoted};`);
    }
  }
  return lines.join('\n');
}

export interface Bundle {
  code: string;
  filename: string;
}

/** What the whole bundle shares while it walks the files. */
interface BundleState {
  byName: Map<string, VirtualFile>;
  modules: Map<string, Module>;
  externals: Map<string, External>;
  /** The file that declares each top-level name. */
  owners: Map<string, string>;
}

/** The file being joined, and the edits made to it. */
interface FileContext {
  state: BundleState;
  file: VirtualFile;
  index: number;
  isEntry: boolean;
  s: MagicString;
  exports: Map<string, string>;
  aliases: string[];
}

type ImportDeclarationNode = Extract<Statement, { type: 'ImportDeclaration' }>;
type ExportNamedNode = Extract<Statement, { type: 'ExportNamedDeclaration' }>;
type ExportDefaultNode = Extract<Statement, { type: 'ExportDefaultDeclaration' }>;
type ExportAllNode = Extract<Statement, { type: 'ExportAllDeclaration' }>;
type ImportSpecifierNode = ImportDeclarationNode['specifiers'][number];
type ExportSpecifierNode = ExportNamedNode['specifiers'][number];

function claim(state: BundleState, name: string, file: string): void {
  const owner = state.owners.get(name);
  if (owner !== undefined && owner !== file) {
    throw new BundleError(
      `\`${name}\` is declared in both ${owner} and ${file}. The files share one scope, so rename one of them.`,
    );
  }
  state.owners.set(name, file);
}

function lookup(target: Module, name: string, importer: string, source: string): string {
  const local = target.exports.get(name);
  if (local === undefined) {
    throw new BundleError(
      `${importer} imports \`${name}\` from "${source}", which does not export it.`,
    );
  }
  return local;
}

/** The name a specifier imports: `default`, `*`, or an export name. */
function getImportedName(specifier: ImportSpecifierNode): string {
  if (specifier.type === 'ImportDefaultSpecifier') {
    return 'default';
  }
  if (specifier.type === 'ImportNamespaceSpecifier') {
    return '*';
  }
  return specifier.imported.type === 'Identifier'
    ? specifier.imported.name
    : specifier.imported.value;
}

function getExportSpecifierNames(specifier: ExportSpecifierNode): {
  local: string;
  exported: string;
} {
  return {
    local: specifier.local.type === 'Identifier' ? specifier.local.name : specifier.local.value,
    exported:
      specifier.exported.type === 'Identifier' ? specifier.exported.name : specifier.exported.value,
  };
}

function isTypeSpecifier(specifier: ImportSpecifierNode): boolean {
  return specifier.type === 'ImportSpecifier' && specifier.importKind === 'type';
}

function findModule(context: FileContext, source: string): Module | undefined {
  const { state, file } = context;
  return state.modules.get(resolveFile(state.byName, file.name, source).name);
}

/** An import of another module joins the shared imports at the top. */
function addExternalImport(context: FileContext, statement: ImportDeclarationNode): void {
  const { state, file } = context;
  const source = statement.source.value;
  let external = state.externals.get(source);
  if (!external) {
    external = { specifiers: new Map() };
    state.externals.set(source, external);
  }
  for (const specifier of statement.specifiers) {
    if (isTypeSpecifier(specifier)) {
      continue;
    }
    const imported = getImportedName(specifier);
    const local = specifier.local.name;
    const previous = external.specifiers.get(local);
    if (previous !== undefined && previous !== imported) {
      throw new BundleError(
        `\`${local}\` means two different imports from "${source}". Use one name for each.`,
      );
    }
    const owner = state.owners.get(local);
    if (owner !== undefined && owner !== file.name && previous === undefined) {
      throw new BundleError(
        `\`${local}\` is declared in ${owner} and imported in ${file.name}. Rename one of them.`,
      );
    }
    state.owners.set(local, file.name);
    external.specifiers.set(local, imported);
  }
}

/**
 * A relative import reads the binding of the file it resolves to. A
 * different local name becomes an alias.
 */
function linkRelativeImport(context: FileContext, statement: ImportDeclarationNode): void {
  const { file } = context;
  const source = statement.source.value;
  const target = findModule(context, source);
  if (!target) {
    return;
  }
  for (const specifier of statement.specifiers) {
    if (specifier.type === 'ImportNamespaceSpecifier') {
      throw new BundleError(
        `${file.name}: \`import * as\` of a local file is not supported in the REPL.`,
      );
    }
    if (isTypeSpecifier(specifier)) {
      continue;
    }
    const local = lookup(target, getImportedName(specifier), file.name, source);
    if (local !== specifier.local.name) {
      claim(context.state, specifier.local.name, file.name);
      context.aliases.push(`const ${specifier.local.name} = ${local};`);
    }
  }
}

function handleImport(context: FileContext, statement: ImportDeclarationNode): void {
  context.s.remove(statement.start, statement.end);
  if (statement.importKind === 'type') {
    return;
  }
  if (isRelative(statement.source.value)) {
    linkRelativeImport(context, statement);
  } else {
    addExternalImport(context, statement);
  }
}

function handleExportNamed(context: FileContext, statement: ExportNamedNode): void {
  const { file, isEntry, s, exports } = context;
  const { declaration } = statement;

  // `export const a = 1` keeps the declaration and drops the keyword.
  if (declaration) {
    const names: string[] = [];
    collectDeclaredNames(declaration, names);
    if ('id' in declaration && declaration.id?.type === 'Identifier' && names.length === 0) {
      // Types and enums: `export interface Props`.
      names.push(declaration.id.name);
    }
    for (const name of names) {
      exports.set(name, name);
    }
    if (!isEntry) {
      s.remove(statement.start, declaration.start);
    }
    return;
  }

  // `export { a as b } from './file'` forwards the other file's binding.
  if (statement.source && isRelative(statement.source.value)) {
    const source = statement.source.value;
    const target = findModule(context, source);
    s.remove(statement.start, statement.end);
    if (!target) {
      return;
    }
    for (const specifier of statement.specifiers) {
      const { local, exported } = getExportSpecifierNames(specifier);
      exports.set(exported, lookup(target, local, file.name, source));
    }
    return;
  }
  if (statement.source) {
    if (!isEntry) {
      throw new BundleError(
        `${file.name}: re-exporting "${statement.source.value}" is only supported in the entry file.`,
      );
    }
    return;
  }

  // `export { a as b }` names a local binding.
  for (const specifier of statement.specifiers) {
    const { local, exported } = getExportSpecifierNames(specifier);
    exports.set(exported, local);
  }
  if (!isEntry) {
    s.remove(statement.start, statement.end);
  }
}

function handleExportDefault(context: FileContext, statement: ExportDefaultNode): void {
  const { isEntry, s, exports } = context;
  const { declaration } = statement;
  if (
    (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') &&
    declaration.id
  ) {
    exports.set('default', declaration.id.name);
    if (!isEntry) {
      s.remove(statement.start, declaration.start);
    }
  } else if (declaration.type === 'Identifier') {
    exports.set('default', declaration.name);
    if (!isEntry) {
      s.remove(statement.start, statement.end);
    }
  } else {
    const local = `__default$${context.index}`;
    exports.set('default', local);
    if (!isEntry) {
      s.overwrite(statement.start, declaration.start, `const ${local} = `);
    }
  }
}

function handleExportAll(context: FileContext, statement: ExportAllNode): void {
  const { file, isEntry, s, exports } = context;
  const source = statement.source.value;
  if (!isRelative(source)) {
    if (!isEntry) {
      throw new BundleError(
        `${file.name}: re-exporting "${source}" is only supported in the entry file.`,
      );
    }
    return;
  }
  if (statement.exported) {
    throw new BundleError(`${file.name}: \`export * as\` is not supported in the REPL.`);
  }
  const target = findModule(context, source);
  s.remove(statement.start, statement.end);
  if (!target) {
    return;
  }
  for (const [name, local] of target.exports) {
    if (name !== 'default') {
      exports.set(name, local);
    }
  }
}

function handleStatement(context: FileContext, statement: Statement): void {
  switch (statement.type) {
    case 'ImportDeclaration':
      handleImport(context, statement);
      break;
    case 'ExportNamedDeclaration':
      handleExportNamed(context, statement);
      break;
    case 'ExportDefaultDeclaration':
      handleExportDefault(context, statement);
      break;
    case 'ExportAllDeclaration':
      handleExportAll(context, statement);
      break;
    default:
      break;
  }
}

/** Joins one file into the bundle and returns its part of the chunk. */
function joinFile(state: BundleState, file: VirtualFile, index: number, isEntry: boolean): string {
  const program = parseFile(file);
  const context: FileContext = {
    state,
    file,
    index,
    isEntry,
    s: new MagicString(file.code),
    exports: new Map(),
    aliases: [],
  };

  // Claim the top-level names first, so a clash names both files.
  for (const statement of program.body) {
    const names: string[] = [];
    collectDeclaredNames(statement, names);
    for (const name of names) {
      claim(state, name, file.name);
    }
  }

  // Then rewrite the imports and exports.
  for (const statement of program.body) {
    handleStatement(context, statement);
  }

  state.modules.set(file.name, { file, program, exports: context.exports });
  if (context.aliases.length > 0) {
    context.s.prepend(`${context.aliases.join('\n')}\n`);
  }
  return `// ${file.name}\n${context.s.toString().trim()}`;
}

export function bundle(files: VirtualFile[]): Bundle {
  if (files.length === 0) {
    throw new BundleError('There are no files.');
  }
  const byName = new Map<string, VirtualFile>();
  let typed = false;
  for (const file of files) {
    byName.set(file.name, file);
    if (/\.tsx?$/.test(file.name)) {
      typed = true;
    }
  }

  // The first file is the entry. Files it never reaches stay out.
  const [entry] = files;
  const order = sortModules(byName, entry);

  const state: BundleState = {
    byName,
    modules: new Map(),
    externals: new Map(),
    owners: new Map(),
  };
  const parts: string[] = [];
  for (const [index, file] of order.entries()) {
    parts.push(joinFile(state, file, index, file === entry));
  }

  const imports = printExternals(state.externals);
  return {
    code: `${imports ? `${imports}\n\n` : ''}${parts.join('\n\n')}\n`,
    filename: typed ? 'bundle.tsx' : 'bundle.jsx',
  };
}
