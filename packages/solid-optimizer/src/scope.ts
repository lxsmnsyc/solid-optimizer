/**
 * Binding resolution for the passes.
 *
 * oxc-parser returns an ESTree AST without scope information, so this module
 * resolves every identifier reference to the declaration it binds to. The
 * passes use it to fold a constant only where it is the same binding, to tell
 * Solid's own components from local ones, and to rename the bindings of an
 * inlined component.
 *
 * Code is treated as an ES module: it is strict, and a function declared in a
 * block is scoped to that block.
 */
import type {
  BindingPattern,
  Class,
  Directive,
  Function as FunctionNode,
  JSXElementName,
  ModuleExportName,
  Node,
  ParamPattern,
  Program,
  Statement,
} from 'oxc-parser';
import type { Parents } from './ast';
import { forEachChild, isIntrinsicTag } from './ast';

export type BindingKind =
  | 'var'
  | 'let'
  | 'const'
  | 'function'
  | 'class'
  | 'param'
  | 'import'
  | 'catch'
  | 'other';

export interface Binding {
  readonly name: string;
  readonly kind: BindingKind;
  readonly scope: Scope;
  /** The identifier that declares the binding. */
  readonly identifier: Node;
  /**
   * The node that declares the binding: a `VariableDeclarator`, a function, a
   * class, an import specifier, or the function or clause that owns a parameter.
   */
  readonly declaration: Node;
  /** The module an import binding comes from. */
  readonly source: string | undefined;
  /** The name an import binding has in its module: an export name, `default`, or `*`. */
  readonly imported: string | undefined;
  /** Every reference, including JSX tag names in opening and closing tags. */
  readonly references: Node[];
  /** Whether anything writes to the binding after its declaration. */
  mutated: boolean;
}

export interface Scope {
  readonly node: Node;
  readonly parent: Scope | undefined;
  /** Whether `var` declarations stop here. */
  readonly isFunction: boolean;
  readonly bindings: Map<string, Binding>;
}

export interface ScopeAnalysis {
  readonly root: Scope;
  /** What each identifier reference resolves to. `undefined` means a global. */
  readonly references: Map<Node, Binding | undefined>;
  /** The scope each scope-creating node opens. A function body shares its function's scope. */
  readonly scopes: Map<Node, Scope>;
  /** Every identifier name in the program, for generating names that collide with none. */
  readonly names: Set<string>;
}

interface PendingReference {
  readonly node: Node;
  readonly name: string;
  readonly scope: Scope;
  readonly write: boolean;
}

export function lookup(scope: Scope, name: string): Binding | undefined {
  let current: Scope | undefined = scope;
  while (current) {
    const binding = current.bindings.get(name);
    if (binding) {
      return binding;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * The innermost scope that contains `node`.
 */
export function scopeAt(analysis: ScopeAnalysis, parents: Parents, node: Node): Scope {
  let current: Node | undefined = parents.get(node);
  while (current) {
    const scope = analysis.scopes.get(current);
    if (scope) {
      return scope;
    }
    current = parents.get(current);
  }
  return analysis.root;
}

/**
 * Whether `scope` is `ancestor` or nested inside it.
 */
export function isWithinScope(scope: Scope, ancestor: Scope): boolean {
  let current: Scope | undefined = scope;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function exportName(name: ModuleExportName): string {
  return name.type === 'Literal' ? name.value : name.name;
}

class Analyzer {
  private scope: Scope;

  readonly root: Scope;

  readonly scopes = new Map<Node, Scope>();

  readonly names = new Set<string>();

  private readonly pending: PendingReference[] = [];

  constructor(program: Program) {
    this.root = {
      node: program,
      parent: undefined,
      isFunction: true,
      bindings: new Map(),
    };
    this.scopes.set(program, this.root);
    this.scope = this.root;
  }

  finish(): Map<Node, Binding | undefined> {
    const references = new Map<Node, Binding | undefined>();
    for (const item of this.pending) {
      const binding = lookup(item.scope, item.name);
      if (binding) {
        binding.references.push(item.node);
        if (item.write) {
          binding.mutated = true;
        }
      }
      references.set(item.node, binding);
    }
    return references;
  }

  private withScope(node: Node, isFunction: boolean, run: () => void): Scope {
    const scope: Scope = {
      node,
      parent: this.scope,
      isFunction,
      bindings: new Map(),
    };
    this.scopes.set(node, scope);
    const previous = this.scope;
    this.scope = scope;
    run();
    this.scope = previous;
    return scope;
  }

  private declare(
    identifier: Node & { name: string },
    kind: BindingKind,
    declaration: Node,
    source?: string,
    imported?: string,
  ): void {
    let target = this.scope;
    if (kind === 'var') {
      while (!target.isFunction && target.parent) {
        target = target.parent;
      }
    }
    this.names.add(identifier.name);
    const existing = target.bindings.get(identifier.name);
    if (existing) {
      // A redeclaration, like `var a; var a;`. The binding is no longer a
      // single declaration, so no pass treats it as a constant.
      existing.mutated = true;
      existing.references.push(identifier);
      return;
    }
    target.bindings.set(identifier.name, {
      name: identifier.name,
      kind,
      scope: target,
      identifier,
      declaration,
      source,
      imported,
      references: [],
      mutated: false,
    });
  }

  private reference(node: Node & { name: string }, write: boolean): void {
    this.names.add(node.name);
    this.pending.push({ node, name: node.name, scope: this.scope, write });
  }

  private declarePattern(
    pattern: BindingPattern | ParamPattern,
    kind: BindingKind,
    declaration: Node,
  ): void {
    switch (pattern.type) {
      case 'Identifier':
        this.declare(pattern, kind, declaration);
        break;
      case 'ObjectPattern':
        for (const property of pattern.properties) {
          if (property.type === 'RestElement') {
            this.declarePattern(property.argument, kind, declaration);
          } else {
            if (property.computed) {
              this.visit(property.key);
            }
            this.declarePattern(property.value, kind, declaration);
          }
        }
        break;
      case 'ArrayPattern':
        for (const element of pattern.elements) {
          if (element) {
            this.declarePattern(element, kind, declaration);
          }
        }
        break;
      case 'AssignmentPattern':
        this.declarePattern(pattern.left, kind, declaration);
        this.visit(pattern.right);
        break;
      case 'RestElement':
        this.declarePattern(pattern.argument, kind, declaration);
        break;
      case 'TSParameterProperty':
        this.declarePattern(pattern.parameter, kind, declaration);
        break;
      default:
        break;
    }
  }

  /**
   * Visits the target of an assignment, marking every identifier it writes.
   */
  private visitTarget(target: Node): void {
    switch (target.type) {
      case 'Identifier':
        this.reference(target, true);
        break;
      case 'ObjectPattern':
        for (const property of target.properties) {
          if (property.type === 'RestElement') {
            this.visitTarget(property.argument);
          } else {
            if (property.computed) {
              this.visit(property.key);
            }
            this.visitTarget(property.value);
          }
        }
        break;
      case 'ArrayPattern':
        for (const element of target.elements) {
          if (element) {
            this.visitTarget(element);
          }
        }
        break;
      case 'AssignmentPattern':
        this.visitTarget(target.left);
        this.visit(target.right);
        break;
      case 'RestElement':
        this.visitTarget(target.argument);
        break;
      case 'ParenthesizedExpression':
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
      case 'TSTypeAssertion':
        this.visitTarget(target.expression);
        break;
      default:
        this.visit(target);
        break;
    }
  }

  private visitStatements(statements: (Statement | Directive)[]): void {
    for (const statement of statements) {
      this.visit(statement);
    }
  }

  private visitFunction(node: FunctionNode): void {
    this.withScope(node, true, () => {
      if (node.type === 'FunctionExpression' && node.id) {
        this.declare(node.id, 'other', node);
      }
      for (const param of node.params) {
        this.declarePattern(param, 'param', node);
      }
      if (node.body) {
        this.scopes.set(node.body, this.scope);
        this.visitStatements(node.body.body);
      }
    });
  }

  private visitClass(node: Class): void {
    for (const decorator of node.decorators) {
      this.visit(decorator);
    }
    if (node.superClass) {
      this.visit(node.superClass);
    }
    for (const element of node.body.body) {
      switch (element.type) {
        case 'MethodDefinition':
        case 'PropertyDefinition':
        case 'AccessorProperty':
          for (const decorator of element.decorators) {
            this.visit(decorator);
          }
          if (element.computed) {
            this.visit(element.key);
          }
          if (element.value) {
            this.visit(element.value);
          }
          break;
        case 'StaticBlock':
          this.withScope(element, true, () => {
            this.visitStatements(element.body);
          });
          break;
        default:
          break;
      }
    }
  }

  private visitJSXName(name: JSXElementName): void {
    if (name.type === 'JSXIdentifier') {
      if (!isIntrinsicTag(name.name) && name.name !== 'this') {
        this.reference(name, false);
      }
    } else if (name.type === 'JSXMemberExpression') {
      let object = name.object;
      while (object.type === 'JSXMemberExpression') {
        object = object.object;
      }
      if (object.name !== 'this') {
        this.reference(object, false);
      }
    }
  }

  visit(node: Node): void {
    switch (node.type) {
      case 'Identifier':
        this.reference(node, false);
        break;
      case 'VariableDeclaration': {
        // `using` binds a disposable resource, so it is never a folding candidate.
        let kind: BindingKind = 'other';
        if (node.kind === 'var' || node.kind === 'let' || node.kind === 'const') {
          kind = node.kind;
        }
        for (const declarator of node.declarations) {
          this.declarePattern(declarator.id, kind, declarator);
          if (declarator.init) {
            this.visit(declarator.init);
          }
        }
        break;
      }
      case 'FunctionDeclaration':
      case 'TSDeclareFunction':
        if (node.id) {
          this.declare(node.id, 'function', node);
        }
        this.visitFunction(node);
        break;
      case 'FunctionExpression':
        this.visitFunction(node);
        break;
      case 'ArrowFunctionExpression':
        this.withScope(node, true, () => {
          for (const param of node.params) {
            this.declarePattern(param, 'param', node);
          }
          if (node.body.type === 'BlockStatement') {
            this.scopes.set(node.body, this.scope);
            this.visitStatements(node.body.body);
          } else {
            this.visit(node.body);
          }
        });
        break;
      case 'ClassDeclaration':
        if (node.id) {
          this.declare(node.id, 'class', node);
        }
        this.visitClass(node);
        break;
      case 'ClassExpression':
        this.withScope(node, false, () => {
          if (node.id) {
            this.declare(node.id, 'other', node);
          }
          this.visitClass(node);
        });
        break;
      case 'BlockStatement':
        this.withScope(node, false, () => {
          this.visitStatements(node.body);
        });
        break;
      case 'ForStatement':
        this.withScope(node, false, () => {
          if (node.init) {
            this.visit(node.init);
          }
          if (node.test) {
            this.visit(node.test);
          }
          if (node.update) {
            this.visit(node.update);
          }
          this.visit(node.body);
        });
        break;
      case 'ForInStatement':
      case 'ForOfStatement':
        this.withScope(node, false, () => {
          if (node.left.type === 'VariableDeclaration') {
            this.visit(node.left);
          } else {
            this.visitTarget(node.left);
          }
          this.visit(node.right);
          this.visit(node.body);
        });
        break;
      case 'CatchClause':
        this.withScope(node, false, () => {
          if (node.param) {
            this.declarePattern(node.param, 'catch', node);
          }
          this.visit(node.body);
        });
        break;
      case 'SwitchStatement':
        this.visit(node.discriminant);
        this.withScope(node, false, () => {
          for (const item of node.cases) {
            if (item.test) {
              this.visit(item.test);
            }
            this.visitStatements(item.consequent);
          }
        });
        break;
      case 'ImportDeclaration': {
        const source = node.source.value;
        for (const specifier of node.specifiers) {
          let imported = '*';
          if (specifier.type === 'ImportSpecifier') {
            imported = exportName(specifier.imported);
          } else if (specifier.type === 'ImportDefaultSpecifier') {
            imported = 'default';
          }
          this.declare(specifier.local, 'import', specifier, source, imported);
        }
        break;
      }
      case 'ExportNamedDeclaration':
        if (node.declaration) {
          this.visit(node.declaration);
        } else if (!node.source) {
          for (const specifier of node.specifiers) {
            if (specifier.local.type === 'Identifier') {
              this.reference(specifier.local, false);
            }
          }
        }
        break;
      case 'ExportAllDeclaration':
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'MetaProperty':
      case 'PrivateIdentifier':
      case 'Super':
      case 'ThisExpression':
      case 'JSXText':
      case 'JSXEmptyExpression':
        break;
      case 'LabeledStatement':
        this.visit(node.body);
        break;
      case 'MemberExpression':
        this.visit(node.object);
        if (node.computed) {
          this.visit(node.property);
        }
        break;
      case 'Property':
        if (node.computed) {
          this.visit(node.key);
        }
        this.visit(node.value);
        break;
      case 'AssignmentExpression':
        this.visitTarget(node.left);
        this.visit(node.right);
        break;
      case 'UpdateExpression':
        this.visitTarget(node.argument);
        break;
      case 'JSXElement':
        this.visitJSXName(node.openingElement.name);
        for (const attribute of node.openingElement.attributes) {
          if (attribute.type === 'JSXSpreadAttribute') {
            this.visit(attribute.argument);
          } else if (attribute.value) {
            this.visit(attribute.value);
          }
        }
        for (const child of node.children) {
          this.visit(child);
        }
        if (node.closingElement) {
          this.visitJSXName(node.closingElement.name);
        }
        break;
      case 'TSEnumDeclaration':
      case 'TSImportEqualsDeclaration':
        this.declare(node.id, 'other', node);
        break;
      case 'TSModuleDeclaration':
        if (node.id.type === 'Identifier') {
          this.declare(node.id, 'other', node);
        }
        break;
      default:
        forEachChild(node, (child) => {
          this.visit(child);
        });
        break;
    }
  }
}

export function analyzeScopes(program: Program): ScopeAnalysis {
  const analyzer = new Analyzer(program);
  analyzer.visit(program);
  const references = analyzer.finish();
  return {
    root: analyzer.root,
    references,
    scopes: analyzer.scopes,
    names: analyzer.names,
  };
}
