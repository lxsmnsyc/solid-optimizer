/**
 * The inline pass: replaces a component call with the component's body.
 *
 * `<Card title="Hi" />` with `function Card(props) { return <div>{props.title}</div>; }`
 * becomes `<div>{"Hi"}</div>`. The JSX transform then sees one tree instead of
 * two, so it emits one template, one clone, and fewer hydration markers.
 *
 * A component inlines when its shape keeps the result equivalent:
 *
 * - It is declared once at the top level of the module, with a capitalized
 *   name, as a function declaration or a `const` bound to a function.
 * - It takes no parameter, or one identifier that is only read as `props.name`.
 * - Its body is statements followed by one final `return` of JSX, or an arrow
 *   function whose body is JSX.
 * - It does not use `this`, `arguments`, `new.target`, or `super`.
 *
 * A call site inlines when it passes plain attributes: no spread, no `ref`,
 * and no namespaced attribute.
 *
 * # How props keep their meaning
 *
 * Solid passes a dynamic prop as a getter, so every read of `props.name`
 * evaluates the attribute's expression again. Inlining replaces each read
 * with the expression itself, which does the same.
 *
 * A static prop, such as an identifier or a function, is evaluated once when
 * the component is created. Its expression is substituted directly when that
 * gives the same value, such as a literal or a binding nothing reassigns, or
 * when the prop is read exactly once. Otherwise its value is stored in a
 * `const` before the component body runs.
 *
 * # Where a component body can go
 *
 * A component whose body is only JSX inlines anywhere JSX can go.
 *
 * Statements, and stored props, have to run where the component would have
 * been created. Solid runs a component untracked, so the statements move into
 * the function whose returned JSX holds the call: a component itself, which
 * also runs untracked. The call has to be in that returned JSX with only
 * intrinsic elements and fragments around it, so it is created exactly once
 * each time that function runs.
 *
 * This also keeps context lookups where they were. A context provider is a
 * component, so a component rendered inside one is never in a position its
 * statements can move out of, and `useContext` still runs under the provider.
 *
 * # Accepted differences
 *
 * - A prop that is a function and is called as `props.name()` runs with
 *   `this` set to its own receiver instead of the props object.
 * - Statements moved into the host run before the host's JSX is created,
 *   instead of while it is created. The order of `onSettled` and effect
 *   registration across siblings can change.
 */
import MagicString from 'magic-string';
import type {
  ArrowFunctionExpression,
  Expression,
  Function as FunctionNode,
  JSXAttribute,
  JSXChild,
  JSXElement,
  JSXExpressionContainer,
  JSXFragment,
  MemberExpression,
  Node,
  ReturnStatement,
  Statement,
} from 'oxc-parser';
import {
  forEachChild,
  isFunctionNode,
  isInsignificant,
  isIntrinsicTag,
  isJSXChild,
  isPrimary,
  unwrap,
} from './ast';
import type { PassContext, ResolvedOptions } from './context';
import { isConstantDeclaration, textOf } from './context';
import type { Piece } from './jsx';
import { keptPiece, replacedPiece, writePieces } from './jsx';
import type { Binding, Scope } from './scope';
import { isWithinScope, lookup, scopeAt } from './scope';

type ComponentFunction = FunctionNode | ArrowFunctionExpression;

interface PropRead {
  readonly member: MemberExpression;
  readonly name: string;
  /** Whether the read can run more than once per component instance. */
  readonly repeated: boolean;
}

interface OuterReference {
  readonly name: string;
  readonly binding: Binding | undefined;
}

interface Component {
  readonly binding: Binding;
  readonly fn: ComponentFunction;
  /** The statement that declares the component, when it can be removed. */
  readonly declaration: Node | undefined;
  readonly statements: readonly Statement[];
  readonly root: JSXElement | JSXFragment;
  readonly props: readonly PropRead[];
  /** Bindings declared inside the component, which get fresh names in every copy. */
  readonly locals: readonly Binding[];
  /** References to bindings outside the component, which must mean the same at the call site. */
  readonly outer: readonly OuterReference[];
}

interface CallSite {
  readonly component: Component;
  readonly element: JSXElement;
}

function isWithin(node: Node, container: Node): boolean {
  return node.start >= container.start && node.end <= container.end;
}

/**
 * Orders call sites so every call inside a component's body comes before
 * the calls to that component, and every call nested inside another call's
 * element comes before that call. An outer call copies the current text of
 * the calls inside it, so they must be done first.
 */
function inBodyOrder(sites: readonly CallSite[]): CallSite[] {
  const pending = [...sites];
  const ordered: CallSite[] = [];
  while (pending.length > 0) {
    const ready = pending.filter(
      (site) =>
        !pending.some(
          (other) =>
            other !== site &&
            (isWithin(other.element, site.component.fn) || isWithin(other.element, site.element)),
        ),
    );
    // A cycle cannot happen, since a component that renders itself is not
    // inlined, but falling back to the original order keeps this finite.
    const next = ready.length > 0 ? ready : pending;
    for (const site of next) {
      ordered.push(site);
      pending.splice(pending.indexOf(site), 1);
    }
  }
  return ordered;
}

/**
 * Where a component's statements go.
 */
type Host =
  | { readonly kind: 'return'; readonly statement: ReturnStatement }
  | { readonly kind: 'arrow'; readonly body: Expression };

/**
 * How one prop is read in a copy of the component.
 */
type PropValue =
  /** Replaced with an expression at every read. */
  | { readonly kind: 'expression'; readonly text: string; readonly primary: boolean }
  /** JSX, spliced in place when read as a JSX child. */
  | { readonly kind: 'jsx'; readonly text: string; readonly primary: boolean }
  /** JSX children, spliced in place when read as a JSX child. */
  | {
      readonly kind: 'children';
      readonly children: readonly JSXChild[];
      readonly text: string;
      readonly primary: boolean;
    };

const UNDEFINED: PropValue = { kind: 'expression', text: 'void 0', primary: false };

function isCapitalized(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function isReservedPropName(name: string): boolean {
  return name === '__proto__' || Object.hasOwn(Object.prototype, name);
}

/**
 * Whether `node` uses what its enclosing function provides: `this`,
 * `arguments`, `super`, `new.target`, `await`, or `yield`. Moving such code
 * into another function would change what it refers to.
 */
function usesFunctionContext(context: PassContext, node: Node): boolean {
  let found = false;
  const visit = (current: Node): void => {
    if (found) {
      return;
    }
    switch (current.type) {
      case 'ThisExpression':
      case 'Super':
      case 'AwaitExpression':
      case 'YieldExpression':
        found = true;
        return;
      case 'MetaProperty':
        found = current.meta.name === 'new';
        return;
      case 'Identifier':
        // `arguments` and a direct `eval` read the function they run in.
        found =
          (current.name === 'arguments' || current.name === 'eval') &&
          context.scopes.references.has(current) &&
          context.scopes.references.get(current) === undefined;
        break;
      // These have their own `this`, `arguments`, and `new.target`.
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ClassDeclaration':
      case 'ClassExpression':
        return;
      default:
        forEachChild(current, visit);
    }
  };
  forEachChild(node, visit);
  return found;
}

/**
 * Whether `node` contains a `return` that belongs to the function being searched.
 */
function containsReturn(node: Node): boolean {
  let found = false;
  const visit = (current: Node): void => {
    if (found || isFunctionNode(current)) {
      return;
    }
    if (current.type === 'ReturnStatement') {
      found = true;
      return;
    }
    forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/**
 * Whether Solid would pass an attribute expression as a getter. The JSX
 * transform wraps any expression that reads a member or calls a function.
 */
function isDynamic(node: Node): boolean {
  let found = false;
  const visit = (current: Node): void => {
    if (found) {
      return;
    }
    switch (current.type) {
      case 'CallExpression':
      case 'NewExpression':
      case 'MemberExpression':
      case 'TaggedTemplateExpression':
      case 'ChainExpression':
      case 'JSXElement':
      case 'JSXFragment':
        found = true;
        break;
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        break;
      default:
        forEachChild(current, visit);
    }
  };
  visit(node);
  return found;
}

/**
 * Whether any expression short of a sequence can replace `node` without
 * parentheses, because its slot is a whole expression of its own.
 */
function acceptsAnyExpression(context: PassContext, node: Node): boolean {
  const parent = context.parents.get(node);
  if (!parent) {
    return false;
  }
  switch (parent.type) {
    case 'JSXExpressionContainer':
    case 'JSXSpreadAttribute':
    case 'SpreadElement':
    case 'ArrayExpression':
    case 'TemplateLiteral':
    case 'ReturnStatement':
      return true;
    case 'CallExpression':
    case 'NewExpression':
      return parent.callee !== node;
    case 'VariableDeclarator':
      return parent.init === node;
    case 'AssignmentExpression':
      return parent.right === node;
    case 'Property':
      return parent.value === node && !parent.shorthand;
    default:
      return false;
  }
}

/**
 * The function a top-level binding declares, if it declares one.
 */
function functionOf(binding: Binding, options: ResolvedOptions): ComponentFunction | undefined {
  const { declaration } = binding;
  if (binding.kind === 'function' && declaration.type === 'FunctionDeclaration') {
    return declaration;
  }
  if (
    isConstantDeclaration(binding, options) &&
    declaration.type === 'VariableDeclarator' &&
    declaration.id === binding.identifier &&
    declaration.init
  ) {
    const init = unwrap(declaration.init);
    if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
      return init;
    }
  }
  return undefined;
}

/**
 * The attributes of a call site by name, or `undefined` when one cannot be inlined.
 */
function attributesOf(element: JSXElement): Map<string, JSXAttribute> | undefined {
  const attributes = new Map<string, JSXAttribute>();
  for (const attribute of element.openingElement.attributes) {
    // A spread can supply any prop, and a namespaced attribute or `ref` is
    // something the JSX transform handles on its own.
    if (
      attribute.type !== 'JSXAttribute' ||
      attribute.name.type !== 'JSXIdentifier' ||
      attribute.name.name === 'ref' ||
      attributes.has(attribute.name.name)
    ) {
      return undefined;
    }
    attributes.set(attribute.name.name, attribute);
  }
  return attributes;
}

function isAssignmentTarget(context: PassContext, node: Node): boolean {
  const parent = context.parents.get(node);
  if (!parent) {
    return false;
  }
  switch (parent.type) {
    case 'AssignmentExpression':
      return parent.left === node;
    case 'UpdateExpression':
      return true;
    case 'UnaryExpression':
      return parent.operator === 'delete';
    case 'ForInStatement':
    case 'ForOfStatement':
      return parent.left === node;
    case 'ArrayPattern':
    case 'ObjectPattern':
    case 'RestElement':
      return true;
    case 'AssignmentPattern':
      return parent.left === node;
    case 'Property':
      return parent.value === node && context.parents.get(parent)?.type === 'ObjectPattern';
    case 'ParenthesizedExpression':
      return isAssignmentTarget(context, parent);
    default:
      return false;
  }
}

class Inliner {
  changed = false;

  private readonly hosts = new Map<Node, { host: Host; texts: string[] }>();

  constructor(private readonly context: PassContext) {}

  // ---------------------------------------------------------------------------
  // Components
  // ---------------------------------------------------------------------------

  private scopeOf(fn: ComponentFunction): Scope | undefined {
    return this.context.scopes.scopes.get(fn);
  }

  /**
   * The statement to remove once nothing uses the component, or `undefined`
   * when the declaration has to stay, like an exported one.
   */
  private removableDeclaration(binding: Binding): Node | undefined {
    const { declaration } = binding;
    if (declaration.type === 'FunctionDeclaration') {
      return this.context.parents.get(declaration)?.type === 'Program' ? declaration : undefined;
    }
    const statement = this.context.parents.get(declaration);
    if (
      statement?.type === 'VariableDeclaration' &&
      statement.declarations.length === 1 &&
      this.context.parents.get(statement)?.type === 'Program'
    ) {
      return statement;
    }
    return undefined;
  }

  private analyzeComponent(binding: Binding): Component | undefined {
    if (!isCapitalized(binding.name) || binding.mutated) {
      return undefined;
    }
    const fn = functionOf(binding, this.context.options);
    if (!fn || fn.async || fn.generator || !fn.body || fn.params.length > 1) {
      return undefined;
    }
    const scope = this.scopeOf(fn);
    if (!scope) {
      return undefined;
    }

    // The body: statements, then one `return` of JSX.
    let statements: Statement[] = [];
    let root: Expression;
    if (fn.body.type === 'BlockStatement') {
      const body = fn.body.body;
      const last = body.at(-1);
      if (last?.type !== 'ReturnStatement' || !last.argument) {
        return undefined;
      }
      const rest: Statement[] = [];
      for (const statement of body.slice(0, -1)) {
        // A directive like `"use strict"` changes how the body runs.
        if ('directive' in statement || containsReturn(statement)) {
          return undefined;
        }
        rest.push(statement);
      }
      statements = rest;
      root = unwrap(last.argument);
    } else {
      root = unwrap(fn.body);
    }
    if (root.type !== 'JSXElement' && root.type !== 'JSXFragment') {
      return undefined;
    }
    if (usesFunctionContext(this.context, fn.body)) {
      return undefined;
    }

    // The parameter is only read as `props.name`.
    const param = fn.params.at(0);
    let paramBinding: Binding | undefined;
    if (param) {
      if (param.type !== 'Identifier') {
        return undefined;
      }
      paramBinding = scope.bindings.get(param.name);
      if (!paramBinding || paramBinding.mutated) {
        return undefined;
      }
    }
    const props: PropRead[] = [];
    for (const reference of paramBinding?.references ?? []) {
      const read = this.propRead(fn, reference);
      if (!read) {
        return undefined;
      }
      props.push(read);
    }

    const locals: Binding[] = [];
    const seen = new Set<Scope>();
    for (const inner of this.context.scopes.scopes.values()) {
      if (seen.has(inner) || !isWithinScope(inner, scope)) {
        continue;
      }
      seen.add(inner);
      for (const local of inner.bindings.values()) {
        if (local !== paramBinding) {
          locals.push(local);
        }
      }
    }

    const outer: OuterReference[] = [];
    for (const [reference, target] of this.context.scopes.references) {
      if (reference.start < fn.start || reference.end > fn.end) {
        continue;
      }
      // A component that renders itself cannot be inlined into itself.
      if (target === binding) {
        return undefined;
      }
      if (target && isWithinScope(target.scope, scope)) {
        continue;
      }
      if (reference.type === 'Identifier' || reference.type === 'JSXIdentifier') {
        outer.push({ name: reference.name, binding: target });
      }
    }

    return {
      binding,
      fn,
      declaration: this.removableDeclaration(binding),
      statements,
      root,
      props,
      locals,
      outer,
    };
  }

  private propRead(fn: ComponentFunction, reference: Node): PropRead | undefined {
    const member = this.context.parents.get(reference);
    if (member?.type !== 'MemberExpression' || member.object !== reference) {
      return undefined;
    }
    let name: string;
    if (!member.computed && member.property.type === 'Identifier') {
      name = member.property.name;
    } else if (
      member.computed &&
      member.property.type === 'Literal' &&
      typeof member.property.value === 'string'
    ) {
      name = member.property.value;
    } else {
      return undefined;
    }
    if (isReservedPropName(name) || isAssignmentTarget(this.context, member)) {
      return undefined;
    }
    let repeated = false;
    let current = this.context.parents.get(member);
    while (current && current !== fn) {
      if (
        isFunctionNode(current) ||
        current.type === 'ForStatement' ||
        current.type === 'ForInStatement' ||
        current.type === 'ForOfStatement' ||
        current.type === 'WhileStatement' ||
        current.type === 'DoWhileStatement'
      ) {
        repeated = true;
        break;
      }
      current = this.context.parents.get(current);
    }
    return { member, name, repeated };
  }

  // ---------------------------------------------------------------------------
  // Call sites
  // ---------------------------------------------------------------------------

  /**
   * Whether a function is a component, which Solid runs untracked. Only a
   * capitalized function bound at its declaration counts.
   */
  private isComponentFunction(fn: Node): boolean {
    if (fn.type === 'FunctionDeclaration') {
      return !fn.async && !fn.generator && fn.id !== null && isCapitalized(fn.id.name);
    }
    if (fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression') {
      return false;
    }
    if (fn.async || fn.generator) {
      return false;
    }
    let parent = this.context.parents.get(fn);
    while (parent?.type === 'ParenthesizedExpression') {
      parent = this.context.parents.get(parent);
    }
    return (
      parent?.type === 'VariableDeclarator' &&
      parent.id.type === 'Identifier' &&
      isCapitalized(parent.id.name)
    );
  }

  /**
   * Where the statements of a component created at `element` can go: the
   * returned JSX of a component, with only intrinsic elements and fragments
   * between it and the call.
   */
  private hostOf(element: JSXElement): { fn: Node; host: Host } | undefined {
    let node: Node = element;
    for (;;) {
      const parent = this.context.parents.get(node);
      if (!parent) {
        return undefined;
      }
      if (parent.type === 'JSXElement') {
        const { name } = parent.openingElement;
        if (name.type !== 'JSXIdentifier' || !isIntrinsicTag(name.name)) {
          return undefined;
        }
        const child = node;
        if (!parent.children.some((item) => item === child)) {
          return undefined;
        }
      } else if (parent.type === 'ReturnStatement') {
        const list = this.context.parents.get(parent);
        if (list?.type !== 'BlockStatement' && list?.type !== 'SwitchCase') {
          return undefined;
        }
        let fn = this.context.parents.get(list);
        while (fn && !isFunctionNode(fn)) {
          fn = this.context.parents.get(fn);
        }
        if (!fn || !this.isComponentFunction(fn)) {
          return undefined;
        }
        return { fn, host: { kind: 'return', statement: parent } };
      } else if (parent.type === 'ArrowFunctionExpression') {
        if (parent.body !== node || !this.isComponentFunction(parent)) {
          return undefined;
        }
        return { fn: parent, host: { kind: 'arrow', body: parent.body } };
      } else if (parent.type !== 'JSXFragment' && parent.type !== 'ParenthesizedExpression') {
        return undefined;
      }
      node = parent;
    }
  }

  private childrenValue(
    element: JSXElement,
    reads: readonly PropRead[],
    fresh: (base: string) => string,
    snapshots: string[],
  ): PropValue | undefined {
    const { children } = element;
    if (children.some((child) => child.type === 'JSXSpreadChild')) {
      return undefined;
    }
    const significant = children.filter((child) => !isInsignificant(child));
    const only = significant.at(0);
    if (only === undefined) {
      return { kind: 'children', children: [], text: 'void 0', primary: false };
    }
    let text: string;
    let primary = true;
    if (significant.length > 1 || only.type === 'JSXText') {
      text = `<>${this.context.s.slice(element.openingElement.end, element.closingElement?.start ?? element.end)}</>`;
    } else if (only.type === 'JSXExpressionContainer') {
      if (only.expression.type === 'JSXEmptyExpression') {
        return undefined;
      }
      // A single expression is passed like an attribute value, such as a
      // render function that has to stay one function.
      const value = this.expressionValue(only.expression, 'children', reads, fresh, snapshots);
      if (value.kind !== 'expression' || value.text !== textOf(this.context, only.expression)) {
        return value;
      }
      text = value.text;
      primary = value.primary;
    } else {
      text = textOf(this.context, only);
    }
    return { kind: 'children', children, text, primary };
  }

  /**
   * How a prop reads in a copy of the component, and the `const` that stores
   * it first when the value has to be evaluated once.
   */
  private propValue(
    attribute: JSXAttribute | undefined,
    reads: readonly PropRead[],
    fresh: (base: string) => string,
    snapshots: string[],
  ): PropValue | undefined {
    if (!attribute) {
      return UNDEFINED;
    }
    const { value } = attribute;
    if (value === null) {
      return { kind: 'expression', text: 'true', primary: true };
    }
    switch (value.type) {
      case 'Literal':
        // An attribute string can hold HTML entities, which are not decoded here.
        if (value.value.includes('&')) {
          return undefined;
        }
        return { kind: 'expression', text: JSON.stringify(value.value), primary: true };
      case 'JSXElement':
      case 'JSXFragment':
        return { kind: 'jsx', text: textOf(this.context, value), primary: true };
      default:
        break;
    }
    const { expression } = value;
    if (expression.type === 'JSXEmptyExpression') {
      return undefined;
    }
    const name = attribute.name.type === 'JSXIdentifier' ? attribute.name.name : 'prop';
    return this.expressionValue(expression, name, reads, fresh, snapshots);
  }

  /**
   * How an expression passed as a prop reads in a copy of the component.
   */
  private expressionValue(
    expression: Expression,
    name: string,
    reads: readonly PropRead[],
    fresh: (base: string) => string,
    snapshots: string[],
  ): PropValue {
    const text = textOf(this.context, expression);
    const inner = unwrap(expression);
    if (inner.type === 'JSXElement' || inner.type === 'JSXFragment') {
      return { kind: 'jsx', text, primary: true };
    }
    const primary = isPrimary(expression);
    if (isDynamic(expression) || this.isStable(inner)) {
      return { kind: 'expression', text, primary };
    }
    // A static value is evaluated once. One read that runs once keeps that.
    const read = reads.at(0);
    if (reads.length === 1 && read && !read.repeated) {
      return { kind: 'expression', text, primary };
    }
    const local = fresh(name);
    snapshots.push(`const ${local} = ${text};`);
    return { kind: 'expression', text: local, primary: true };
  }

  /**
   * Whether evaluating `node` again gives the same value.
   */
  private isStable(node: Node): boolean {
    switch (node.type) {
      case 'Literal':
        // A regular expression literal creates a new object each time.
        return !('regex' in node);
      case 'TemplateLiteral':
        return node.expressions.length === 0;
      case 'UnaryExpression':
        return node.operator === '-' && node.argument.type === 'Literal';
      case 'Identifier': {
        const { references } = this.context.scopes;
        if (!references.has(node)) {
          return false;
        }
        const binding = references.get(node);
        if (!binding) {
          return node.name === 'undefined' || node.name === 'NaN' || node.name === 'Infinity';
        }
        return !binding.mutated;
      }
      default:
        return false;
    }
  }

  private freshName(base: string): string {
    const { names } = this.context.scopes;
    let index = 1;
    let name = `${base}$${String(index)}`;
    while (names.has(name)) {
      index += 1;
      name = `${base}$${String(index)}`;
    }
    names.add(name);
    return name;
  }

  /**
   * Inlines `component` at `element`. Returns whether it did.
   */
  private inline(component: Component, element: JSXElement): boolean {
    const attributes = attributesOf(element);
    if (!attributes) {
      return false;
    }
    const hasChildren = element.children.some((child) => !isInsignificant(child));
    if (hasChildren && attributes.has('children')) {
      return false;
    }
    for (const attribute of attributes.values()) {
      if (attribute.value && usesFunctionContext(this.context, attribute.value)) {
        return false;
      }
    }
    for (const child of element.children) {
      if (usesFunctionContext(this.context, child)) {
        return false;
      }
    }

    // What each prop reads as.
    const snapshots: string[] = [];
    const fresh = (base: string): string => this.freshName(base);
    const readsByName = new Map<string, PropRead[]>();
    for (const read of component.props) {
      const reads = readsByName.get(read.name) ?? [];
      reads.push(read);
      readsByName.set(read.name, reads);
    }
    const values = new Map<string, PropValue>();
    for (const [name, reads] of readsByName) {
      let value: PropValue | undefined;
      if (name === 'children' && !attributes.has('children')) {
        value = this.childrenValue(element, reads, fresh, snapshots);
      } else {
        value = this.propValue(attributes.get(name), reads, fresh, snapshots);
      }
      if (!value) {
        return false;
      }
      values.set(name, value);
    }

    // The component's outer references must mean the same at the call site.
    const scope = scopeAt(this.context.scopes, this.context.parents, element);
    for (const reference of component.outer) {
      if (lookup(scope, reference.name) !== reference.binding) {
        return false;
      }
    }

    const hoisted = component.statements.length > 0 || snapshots.length > 0;
    const host = hoisted ? this.hostOf(element) : undefined;
    if (hoisted && !host) {
      return false;
    }

    // Build the copy on the original code, so this pass's other edits stay out of it.
    const copy = new MagicString(this.context.code);
    this.renameLocals(copy, component, fresh);
    this.substituteProps(copy, component, values);

    const rootText = copy.slice(component.root.start, component.root.end);
    this.context.s.overwrite(element.start, element.end, rootText);

    if (host) {
      const first = component.statements.at(0);
      const last = component.statements.at(-1);
      const texts = [...snapshots];
      if (first && last) {
        texts.push(copy.slice(first.start, last.end));
      }
      const entry = this.hosts.get(host.fn) ?? { host: host.host, texts: [] };
      entry.texts.push(...texts);
      this.hosts.set(host.fn, entry);
    }
    return true;
  }

  private renameLocals(
    copy: MagicString,
    component: Component,
    fresh: (base: string) => string,
  ): void {
    for (const local of component.locals) {
      const name = fresh(local.name);
      for (const node of [local.identifier, ...local.references]) {
        const parent = this.context.parents.get(node);
        // `{ a }` and `{ a = 1 }` are shorthand for `{ a: a }` and `{ a: a = 1 }`.
        const shorthand =
          (parent?.type === 'Property' && parent.shorthand) ||
          (parent?.type === 'AssignmentPattern' &&
            this.context.parents.get(parent)?.type === 'Property' &&
            parent.left === node &&
            this.isShorthandValue(parent));
        copy.overwrite(node.start, node.end, shorthand ? `${local.name}: ${name}` : name);
      }
    }
  }

  private isShorthandValue(node: Node): boolean {
    const parent = this.context.parents.get(node);
    return parent?.type === 'Property' && parent.shorthand && parent.value === node;
  }

  private substituteProps(
    copy: MagicString,
    component: Component,
    values: ReadonlyMap<string, PropValue>,
  ): void {
    // Reads that are a JSX child on their own, like `{props.children}`,
    // splice their JSX in place. They are grouped by parent so neighboring
    // text stays apart.
    const spliced = new Map<JSXElement | JSXFragment, Map<JSXChild, Piece>>();
    for (const read of component.props) {
      const value = values.get(read.name);
      if (!value) {
        continue;
      }
      const container = this.context.parents.get(read.member);
      const parent = container ? this.context.parents.get(container) : undefined;
      if (
        value.kind !== 'expression' &&
        container?.type === 'JSXExpressionContainer' &&
        (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment') &&
        isJSXChild(container, this.context.parents)
      ) {
        const pieces = spliced.get(parent) ?? new Map<JSXChild, Piece>();
        pieces.set(container, this.splicedPiece(container, value));
        spliced.set(parent, pieces);
        continue;
      }
      const bare = value.primary || acceptsAnyExpression(this.context, read.member);
      copy.overwrite(read.member.start, read.member.end, bare ? value.text : `(${value.text})`);
    }
    for (const [parent, pieces] of spliced) {
      writePieces(
        copy,
        parent.children.map((child) => pieces.get(child) ?? keptPiece(child)),
      );
    }
  }

  private splicedPiece(container: JSXExpressionContainer, value: PropValue): Piece {
    if (value.kind === 'children') {
      const first = value.children.at(0);
      const last = value.children.at(-1);
      if (!first || !last) {
        return replacedPiece(container, '');
      }
      return {
        node: container,
        text: this.context.s.slice(first.start, last.end),
        startText: first.type === 'JSXText' ? first : undefined,
        endText: last.type === 'JSXText' ? last : undefined,
      };
    }
    return replacedPiece(container, value.text);
  }

  // ---------------------------------------------------------------------------
  // Pass
  // ---------------------------------------------------------------------------

  run(): void {
    const components: Component[] = [];
    for (const binding of this.context.scopes.root.bindings.values()) {
      const component = this.analyzeComponent(binding);
      if (component) {
        components.push(component);
      }
    }
    if (components.length === 0) {
      return;
    }

    const sites: CallSite[] = [];
    const otherUses = new Map<Component, number>();
    for (const component of components) {
      let uses = 0;
      for (const reference of component.binding.references) {
        const parent = this.context.parents.get(reference);
        if (parent?.type === 'JSXClosingElement') {
          continue;
        }
        const element = parent ? this.context.parents.get(parent) : undefined;
        if (parent?.type === 'JSXOpeningElement' && element?.type === 'JSXElement') {
          sites.push({ component, element });
        } else {
          uses += 1;
        }
      }
      otherUses.set(component, uses);
    }

    // Inner call sites first, so an outer one copies their inlined text.
    sites.sort((a, b) => a.element.end - b.element.end);
    const inlined = new Map<Component, JSXElement[]>();
    // A component whose body changed in this pass is copied in the next one,
    // from its new body. A copy made now would miss what was inlined into it.
    const changedBodies = new Set<Component>();
    for (const site of inBodyOrder(sites)) {
      if (!changedBodies.has(site.component) && this.inline(site.component, site.element)) {
        this.changed = true;
        const elements = inlined.get(site.component) ?? [];
        elements.push(site.element);
        inlined.set(site.component, elements);
        for (const component of components) {
          if (isWithin(site.element, component.fn)) {
            changedBodies.add(component);
          }
        }
      } else {
        otherUses.set(site.component, (otherUses.get(site.component) ?? 0) + 1);
      }
    }

    this.writeHosts();

    // A component nothing uses anymore is removed. A copy made in this pass
    // comes from the original code, so a component used inside a copied
    // component stays until the next pass inlines it there too.
    const copied = [...inlined.keys()];
    for (const [component, elements] of inlined) {
      const insideCopy = elements.some((element) =>
        copied.some(
          (other) =>
            other !== component && element.start >= other.fn.start && element.end <= other.fn.end,
        ),
      );
      if (component.declaration && otherUses.get(component) === 0 && !insideCopy) {
        this.context.s.remove(component.declaration.start, component.declaration.end);
      }
    }
  }

  /**
   * The whitespace before `position` on its line.
   */
  private indentationAt(position: number): string {
    const { code } = this.context;
    const lineStart = code.lastIndexOf('\n', position - 1) + 1;
    return /^[ \t]*/.exec(code.slice(lineStart, position))?.[0] ?? '';
  }

  private writeHosts(): void {
    for (const { host, texts } of this.hosts.values()) {
      if (host.kind === 'return') {
        const indent = this.indentationAt(host.statement.start);
        this.context.s.prependRight(
          host.statement.start,
          texts.map((text) => `${text}\n${indent}`).join(''),
        );
      } else {
        this.context.s.prependRight(host.body.start, `{ ${texts.join(' ')} return `);
        this.context.s.appendLeft(host.body.end, '; }');
      }
    }
  }
}

/**
 * Runs the inline pass over a parsed program. Returns whether anything changed.
 */
export function inline(context: PassContext): boolean {
  const inliner = new Inliner(context);
  inliner.run();
  return inliner.changed;
}
