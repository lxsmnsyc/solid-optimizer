/**
 * Keeps Solid's runtime helpers reachable while JSX waits in a bundled chunk.
 *
 * Solid's JSX transform imports helpers like `template` and `insert` from
 * `solid-js/web`. When the transform runs on a chunk, the bundle is already
 * built, so a new bare import cannot be resolved or bundled anymore. Instead,
 * every module imports the helpers it will need before bundling, and passes
 * them to a marker call. The bundler keeps the call, since it could have side
 * effects, and renames the helpers to whatever they are called in the chunk.
 * The chunk step reads the marker, removes it, and points the lowered code at
 * those names.
 *
 * The marker also records which bindings are Solid's built-in components, so
 * the fold pass still recognizes `Show` after the bundler renamed it.
 */
import MagicString from 'magic-string';
import type {
  ExpressionStatement,
  ImportDeclarationSpecifier,
  ImportSpecifier,
  Node,
} from 'oxc-parser';
import { collectParents, forEachChild, parse } from '../ast';
import type { ScopeAnalysis } from '../scope';
import { analyzeScopes, lookup, scopeAt } from '../scope';

export const MARKER = '__SOLID_OPTIMIZER_KEEP__';

/**
 * The lowered chunk needs a helper that no module in the chunk kept.
 */
export class MissingHelperError extends Error {
  override readonly name = 'MissingHelperError';
}

const HELPER_PREFIX = 'helper:';
const BUILT_IN_PREFIX = 'builtin:';

export interface EditResult {
  code: string;
  map: string;
}

function generateMap(s: MagicString, filename: string): string {
  return s.generateMap({ source: filename, hires: true, includeContent: true }).toString();
}

function freshName(scopes: ScopeAnalysis, base: string): string {
  let name = base;
  let index = 1;
  while (scopes.names.has(name)) {
    name = `${base}$${String(index)}`;
    index += 1;
  }
  scopes.names.add(name);
  return name;
}

/**
 * Whether an import specifier was added by Solid's JSX transform, which
 * names every helper it imports `_$name`.
 */
function isGeneratedSpecifier(specifier: ImportDeclarationSpecifier): boolean {
  return specifier.type === 'ImportSpecifier' && specifier.local.name.startsWith('_$');
}

function exportedName(specifier: ImportSpecifier): string {
  return specifier.imported.type === 'Literal' ? specifier.imported.value : specifier.imported.name;
}

/**
 * The helpers Solid's JSX transform imported from `source` into its output.
 * The module's own imports, including type imports, are left out.
 */
export function generatedImports(code: string, filename: string, source: string): string[] {
  const program = parse(filename, code);
  const names: string[] = [];
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== source) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportSpecifier' && isGeneratedSpecifier(specifier)) {
        names.push(exportedName(specifier));
      }
    }
  }
  return names;
}

export interface MarkerOptions {
  /** The module the helpers come from, usually `solid-js/web`. */
  readonly moduleName: string;
  /** The helpers to keep. */
  readonly helpers: ReadonlySet<string>;
  /** The modules Solid's built-in components come from. */
  readonly moduleSources: readonly string[];
  /** The names of Solid's built-in components. */
  readonly builtIns: ReadonlySet<string>;
}

/**
 * Appends the helper imports and the marker call to a module.
 * Returns `undefined` when the module needs no helper.
 */
export function addMarker(
  code: string,
  filename: string,
  options: MarkerOptions,
): EditResult | undefined {
  if (options.helpers.size === 0) {
    return undefined;
  }
  const program = parse(filename, code);
  const scopes = analyzeScopes(program);
  const entries: string[] = [];
  const specifiers: string[] = [];
  for (const helper of options.helpers) {
    const local = freshName(scopes, `__so$${helper}`);
    specifiers.push(`${helper} as ${local}`);
    entries.push(`${JSON.stringify(HELPER_PREFIX + helper)}: ${local}`);
  }
  for (const statement of program.body) {
    if (
      statement.type !== 'ImportDeclaration' ||
      statement.importKind === 'type' ||
      !options.moduleSources.includes(statement.source.value)
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type') {
        continue;
      }
      const imported = exportedName(specifier);
      if (options.builtIns.has(imported)) {
        entries.push(`${JSON.stringify(BUILT_IN_PREFIX + imported)}: ${specifier.local.name}`);
      }
    }
  }
  const s = new MagicString(code);
  s.append(
    `\nimport { ${specifiers.join(', ')} } from ${JSON.stringify(options.moduleName)};\n` +
      `${MARKER}({ ${entries.join(', ')} });\n`,
  );
  return { code: s.toString(), map: generateMap(s, filename) };
}

export interface ChunkRuntime extends EditResult {
  /** The chunk's name for each helper, keyed by the name `solid-js/web` exports. */
  readonly helpers: ReadonlyMap<string, string>;
  /** The built-in each chunk binding refers to, keyed by the chunk's name for it. */
  readonly builtInAliases: Record<string, string>;
}

function propertyKey(node: Node): string | undefined {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === 'Identifier') {
    return node.name;
  }
  return undefined;
}

/**
 * Reads and removes the marker calls of a chunk.
 * Returns `undefined` when the chunk has none.
 */
export function readMarkers(code: string, filename: string): ChunkRuntime | undefined {
  if (!code.includes(MARKER)) {
    return undefined;
  }
  const program = parse(filename, code);
  const s = new MagicString(code);
  const helpers = new Map<string, string>();
  const builtInAliases: Record<string, string> = {};
  // A marker is usually a top-level statement. The bundler moves a module
  // into an init function when it has to run lazily, such as a module that
  // a dynamic import pulled into the same chunk, so every statement is searched.
  const markers: ExpressionStatement[] = [];
  const visit = (node: Node): void => {
    if (
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'CallExpression' &&
      node.expression.callee.type === 'Identifier' &&
      node.expression.callee.name === MARKER
    ) {
      markers.push(node);
      return;
    }
    forEachChild(node, visit);
  };
  visit(program);
  for (const statement of markers) {
    s.remove(statement.start, statement.end);
    if (statement.expression.type !== 'CallExpression') {
      continue;
    }
    const argument = statement.expression.arguments.at(0);
    if (argument?.type !== 'ObjectExpression') {
      continue;
    }
    for (const property of argument.properties) {
      if (property.type !== 'Property' || property.value.type !== 'Identifier') {
        continue;
      }
      const key = propertyKey(property.key);
      if (key?.startsWith(HELPER_PREFIX)) {
        helpers.set(key.slice(HELPER_PREFIX.length), property.value.name);
      } else if (key?.startsWith(BUILT_IN_PREFIX)) {
        builtInAliases[property.value.name] = key.slice(BUILT_IN_PREFIX.length);
      }
    }
  }
  if (markers.length === 0) {
    return undefined;
  }
  return {
    code: s.toString(),
    map: generateMap(s, filename),
    helpers,
    builtInAliases,
  };
}

/**
 * Replaces the helper imports that Solid's JSX transform added to a chunk
 * with the chunk's own names for those helpers.
 */
export function linkHelpers(
  code: string,
  filename: string,
  moduleName: string,
  helpers: ReadonlyMap<string, string>,
): EditResult {
  const program = parse(filename, code);
  const scopes = analyzeScopes(program);
  const parents = collectParents(program);
  const s = new MagicString(code);
  for (const statement of program.body) {
    if (
      statement.type !== 'ImportDeclaration' ||
      statement.source.value !== moduleName ||
      !statement.specifiers.every(isGeneratedSpecifier)
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier') {
        continue;
      }
      const imported = exportedName(specifier);
      const target = helpers.get(imported);
      if (target === undefined) {
        throw new MissingHelperError(
          `[solid-optimizer] ${filename} needs "${imported}" from "${moduleName}", but no module in the chunk imports it.`,
        );
      }
      const binding = scopes.root.bindings.get(specifier.local.name);
      const targetBinding = scopes.root.bindings.get(target);
      if (!targetBinding) {
        throw new Error(
          `[solid-optimizer] ${filename} has no top-level "${target}" for "${imported}".`,
        );
      }
      for (const reference of binding?.references ?? []) {
        if (lookup(scopeAt(scopes, parents, reference), target) !== targetBinding) {
          throw new Error(
            `[solid-optimizer] ${filename} shadows "${target}" where the JSX transform uses "${imported}".`,
          );
        }
        s.overwrite(reference.start, reference.end, target);
      }
    }
    s.remove(statement.start, statement.end);
  }
  return { code: s.toString(), map: generateMap(s, filename) };
}
