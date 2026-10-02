/**
 * Copies components from other modules into a module before bundling, so
 * the inline pass can inline them there.
 *
 * In chunk mode, the chunk step inlines any component in the same chunk.
 * It runs after the bundler has split the chunks, so a shared chunk still
 * exports what an inlined component needed, like the runtime's `spread`.
 * Inlining an imported component while its importer is transformed lets
 * the bundler drop the component, and what only it used, before splitting.
 *
 * A copy refers to the bindings of its own module. Imports are imported
 * again by the module they resolve to. A binding the module declares but
 * does not export is exported under an extra name, which `exposeLocals`
 * adds when the module is transformed.
 */
import MagicString from 'magic-string';
import type { Node, Program } from 'oxc-parser';
import { forEachChild, parse, unwrap } from '../ast';
import type { Binding, ScopeAnalysis } from '../scope';
import { analyzeScopes } from '../scope';
import { MARKER } from './runtime';
import type { EditResult } from './runtime';

/**
 * Whether a binding is `const X = createContext(...)`, with `createContext`
 * imported from Solid.
 */
function isContext(
  binding: Binding,
  scopes: ScopeAnalysis,
  moduleSources: readonly string[],
): boolean {
  const { declaration } = binding;
  if (
    binding.kind !== 'const' ||
    binding.mutated ||
    declaration.type !== 'VariableDeclarator' ||
    !declaration.init
  ) {
    return false;
  }
  const init = unwrap(declaration.init);
  if (init.type !== 'CallExpression' || init.callee.type !== 'Identifier') {
    return false;
  }
  const callee = scopes.references.get(init.callee);
  return (
    callee?.kind === 'import' &&
    callee.imported === 'createContext' &&
    callee.source !== undefined &&
    moduleSources.includes(callee.source)
  );
}

/** The prefix of the name a module exports a local binding under. */
export const LOCAL_EXPORT = '__so_local$';

function generateMap(s: MagicString, filename: string): string {
  return s.generateMap({ source: filename, hires: true, includeContent: true }).toString();
}

function isCapitalized(name: string): boolean {
  return /^[A-Z]/.test(name);
}

interface TopLevelFunction {
  readonly binding: Binding;
  /** The function, or the arrow or function expression a `const` holds. */
  readonly fn: Node;
  /** The node to copy: the function declaration, or the expression. */
  readonly kind: 'declaration' | 'expression';
}

/**
 * The function a top-level binding holds: `function A() {}`, or
 * `const A = () => ...`.
 */
function functionOf(binding: Binding): TopLevelFunction | undefined {
  const { declaration } = binding;
  if (declaration.type === 'FunctionDeclaration') {
    return { binding, fn: declaration, kind: 'declaration' };
  }
  if (
    declaration.type === 'VariableDeclarator' &&
    binding.kind === 'const' &&
    declaration.id === binding.identifier &&
    declaration.init
  ) {
    const init = unwrap(declaration.init);
    if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
      return { binding, fn: init, kind: 'expression' };
    }
  }
  return undefined;
}

/**
 * The names a module exports, each with the top-level binding it exports.
 */
function exportsOf(program: Program, scopes: ScopeAnalysis): Map<string, Binding> {
  const exports = new Map<string, Binding>();
  const { bindings } = scopes.root;
  for (const statement of program.body) {
    if (statement.type === 'ExportNamedDeclaration' && !statement.source) {
      const { declaration } = statement;
      if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
        const binding = bindings.get(declaration.id.name);
        if (binding) {
          exports.set(declaration.id.name, binding);
        }
      } else if (declaration?.type === 'VariableDeclaration') {
        const declared = declaration.declarations.map((declarator) =>
          declarator.id.type === 'Identifier' ? bindings.get(declarator.id.name) : undefined,
        );
        for (const binding of declared.filter((item) => item !== undefined)) {
          exports.set(binding.name, binding);
        }
      }
      for (const specifier of statement.specifiers) {
        const local = specifier.local.type === 'Identifier' ? specifier.local.name : undefined;
        const exported =
          specifier.exported.type === 'Identifier'
            ? specifier.exported.name
            : specifier.exported.value;
        const binding = local === undefined ? undefined : bindings.get(local);
        if (binding) {
          exports.set(exported, binding);
        }
      }
    } else if (statement.type === 'ExportDefaultDeclaration') {
      const { declaration } = statement;
      if (declaration.type === 'FunctionDeclaration' && declaration.id) {
        const binding = bindings.get(declaration.id.name);
        if (binding) {
          exports.set('default', binding);
        }
      } else if (declaration.type === 'Identifier') {
        const binding = bindings.get(declaration.name);
        if (binding) {
          exports.set('default', binding);
        }
      }
    }
  }
  return exports;
}

/**
 * The top-level bindings a function refers to, other than itself.
 */
function outerBindings(fn: Node, self: Binding, scopes: ScopeAnalysis): Map<Node, Binding> {
  const outer = new Map<Node, Binding>();
  for (const [reference, binding] of scopes.references) {
    if (
      binding &&
      binding !== self &&
      binding.scope === scopes.root &&
      reference.start >= fn.start &&
      reference.end <= fn.end
    ) {
      outer.set(reference, binding);
    }
  }
  return outer;
}

/**
 * Exports the top-level bindings that the module's exported components
 * refer to but the module does not export, under an extra name. A copy of
 * such a component in another module imports them from here.
 */
export function exposeLocals(code: string, filename: string): EditResult | undefined {
  const program = parse(filename, code);
  const scopes = analyzeScopes(program);
  const exports = exportsOf(program, scopes);
  const exported = new Set(exports.values());
  const needed = new Set<Binding>();
  for (const [name, binding] of exports) {
    const component =
      isCapitalized(binding.name) || name === 'default' ? functionOf(binding) : undefined;
    if (!component) {
      continue;
    }
    for (const outer of outerBindings(component.fn, binding, scopes).values()) {
      if (outer.kind !== 'import' && !exported.has(outer)) {
        needed.add(outer);
      }
    }
  }
  if (needed.size === 0) {
    return undefined;
  }
  const s = new MagicString(code);
  const specifiers = [...needed].map(
    (binding) => `${binding.name} as ${LOCAL_EXPORT}${binding.name}`,
  );
  s.append(`\nexport { ${specifiers.join(', ')} };\n`);
  return { code: s.toString(), map: generateMap(s, filename) };
}

/** A binding a copied component needs from its own module's scope. */
export type Dependency =
  /** An import of that module, imported again by the module it resolves to. */
  | { readonly kind: 'import'; readonly source: string; readonly imported: string }
  /** A binding that module exports, imported from it under this name. */
  | { readonly kind: 'export'; readonly exported: string; readonly context: boolean };

export interface ExportedComponent {
  /** Each top-level binding the component refers to, by its name in the module. */
  readonly dependencies: ReadonlyMap<string, Dependency>;
  /**
   * The component's declaration under `name`, with each dependency renamed
   * as `rename` gives it.
   */
  readonly copy: (name: string, rename: ReadonlyMap<string, string>) => string;
}

/**
 * Reads the component a module exports under `exportName`, from the module
 * as the bundler loaded it. `undefined` when that export is not a function
 * component, or it refers to a top-level binding the module cannot export.
 */
export function readExportedComponent(
  code: string,
  filename: string,
  exportName: string,
  moduleSources: readonly string[],
): ExportedComponent | undefined {
  const program = parse(filename, code);
  const scopes = analyzeScopes(program);
  const exports = exportsOf(program, scopes);
  const binding = exports.get(exportName);
  const component = binding ? functionOf(binding) : undefined;
  if (!binding || !component) {
    return undefined;
  }
  const exportNames = new Map<Binding, string>();
  for (const [name, exported] of exports) {
    if (!exportNames.has(exported)) {
      exportNames.set(exported, name);
    }
  }

  const outer = outerBindings(component.fn, binding, scopes);
  const dependencies = new Map<string, Dependency>();
  for (const dependency of outer.values()) {
    if (dependencies.has(dependency.name)) {
      continue;
    }
    if (dependency.kind === 'import') {
      if (dependency.source === undefined || dependency.imported === undefined) {
        return undefined;
      }
      dependencies.set(dependency.name, {
        kind: 'import',
        source: dependency.source,
        imported: dependency.imported,
      });
      continue;
    }
    // A local binding is exported under its extra name, which `exposeLocals` added.
    const name = exportNames.get(dependency);
    if (name === undefined) {
      return undefined;
    }
    dependencies.set(dependency.name, {
      kind: 'export',
      exported: name,
      context: isContext(dependency, scopes, moduleSources),
    });
  }

  // The helper markers in the copy belong to the module it comes from.
  const markers: Node[] = [];
  const findMarkers = (node: Node): void => {
    if (
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'CallExpression' &&
      node.expression.callee.type === 'Identifier' &&
      node.expression.callee.name === MARKER
    ) {
      markers.push(node);
      return;
    }
    forEachChild(node, findMarkers);
  };
  findMarkers(component.fn);

  const copy = (name: string, rename: ReadonlyMap<string, string>): string => {
    const s = new MagicString(code);
    for (const [reference, dependency] of outer) {
      const renamed = rename.get(dependency.name);
      if (renamed !== undefined && renamed !== dependency.name) {
        s.overwrite(reference.start, reference.end, renamed);
      }
    }
    for (const marker of markers) {
      s.remove(marker.start, marker.end);
    }
    if (
      component.kind === 'declaration' &&
      component.fn.type === 'FunctionDeclaration' &&
      component.fn.id
    ) {
      s.overwrite(component.fn.id.start, component.fn.id.end, name);
      return s.slice(component.fn.start, component.fn.end);
    }
    return `const ${name} = ${s.slice(component.fn.start, component.fn.end)};`;
  };
  return { dependencies, copy };
}
