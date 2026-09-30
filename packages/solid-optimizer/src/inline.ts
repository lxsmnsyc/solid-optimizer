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
 * A context provider is a component, so statements do not move out of it,
 * and `useContext` still runs under it. The exception is a provider whose
 * subtree only runs visible code. Statements move out through it, and each
 * `useContext` of its context in a copy becomes its value. See `provider.ts`.
 *
 * The props can also be read through `merge()` and `omit()` views declared
 * in the component. Each call site knows which props it passes, so a read
 * of a view resolves to a prop, a literal default, or `undefined`, and a
 * spread of a view becomes the attributes it holds.
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
  CallExpression,
  Expression,
  Function as FunctionNode,
  JSXAttribute,
  JSXChild,
  JSXElement,
  JSXExpressionContainer,
  JSXFragment,
  JSXSpreadAttribute,
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
import type { ClosedOptions, Provider } from './provider';
import {
  contextBinding,
  contextReads,
  findProviders,
  isClosed,
  solidCallee,
  stableValueText,
} from './provider';
import { keptPiece, replacedPiece, writePieces } from './jsx';
import type { Binding, Scope } from './scope';
import { isWithinScope, lookup, scopeAt } from './scope';
import { evaluate, literalText } from './value';

type ComponentFunction = FunctionNode | ArrowFunctionExpression;

interface ReadCount {
  /** Whether the read can run more than once per component instance. */
  readonly repeated: boolean;
}

interface PropRead extends ReadCount {
  readonly member: MemberExpression;
  readonly name: string;
}

/**
 * One source of a `merge()` or `omit()` view: the props, or an object of
 * literal defaults, with the keys an `omit()` hides from it.
 */
interface ViewSource {
  /** The default of each key, as literal text, or `undefined` for the props. */
  readonly defaults: ReadonlyMap<string, string> | undefined;
  readonly hidden: ReadonlySet<string>;
}

/** A props object made with `merge()` and `omit()`, in source order. */
interface View {
  readonly sources: readonly ViewSource[];
}

interface ViewRead extends PropRead {
  readonly view: View;
}

interface ResolvedSpread {
  readonly spread: ViewSpread;
  /** Each key and its default text, or `undefined` when the props hold it. */
  readonly keys: ReadonlyMap<string, string | undefined>;
}

interface ResolvedViews {
  /** Reads of the props, including view reads the props answer. */
  readonly propReads: readonly PropRead[];
  /** View reads a default or nothing answers, and their text. */
  readonly texts: ReadonlyMap<Node, string>;
  readonly spreads: readonly ResolvedSpread[];
}

interface ViewSpread extends ReadCount {
  readonly attribute: JSXSpreadAttribute;
  readonly element: JSXElement;
  readonly view: View;
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
  /** The props parameter, when there is one. */
  readonly param: Binding | undefined;
  /** Reads of a `merge()` or `omit()` view, which a call site resolves. */
  readonly viewReads: readonly ViewRead[];
  /** Spreads of a view onto an element, which become the attributes it holds. */
  readonly viewSpreads: readonly ViewSpread[];
  /** The declarations of the views, which a copy drops. */
  readonly viewDeclarations: readonly Statement[];
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
export function usesFunctionContext(context: PassContext, node: Node): boolean {
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

  /**
   * Providers whose subtree is closed, so statements can move out through
   * them. Each maps to the text its reads become, or `undefined` when a
   * binding that never changes is read at each site.
   */
  private readonly transparent = new Map<JSXElement, { provider: Provider; text?: string }>();

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
        // TypeScript's AST gives every expression statement a `directive`
        // key, which is `null` unless the statement is a directive.
        const directive = 'directive' in statement ? statement.directive : null;
        if (typeof directive === 'string' || containsReturn(statement)) {
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
    const views = this.analyzeViews(fn, scope, statements, paramBinding);
    if (!views) {
      return undefined;
    }
    const props: PropRead[] = [];
    for (const reference of paramBinding?.references ?? []) {
      if (views.arguments.has(reference)) {
        continue;
      }
      const read = this.propRead(fn, reference);
      if (!read) {
        return undefined;
      }
      props.push(read);
    }
    statements = statements.filter((statement) => !views.declarations.includes(statement));

    const locals: Binding[] = [];
    const seen = new Set<Scope>();
    for (const inner of this.context.scopes.scopes.values()) {
      if (seen.has(inner) || !isWithinScope(inner, scope)) {
        continue;
      }
      seen.add(inner);
      for (const local of inner.bindings.values()) {
        // A view's declaration and every use of it are replaced in a copy.
        if (local !== paramBinding && !views.bindings.has(local)) {
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
      param: paramBinding,
      viewReads: views.reads,
      viewSpreads: views.spreads,
      viewDeclarations: views.declarations,
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
    return { member, name, repeated: this.isRepeated(fn, member) };
  }

  /**
   * Whether `node` can run more than once each time `fn` runs.
   */
  private isRepeated(fn: ComponentFunction, node: Node): boolean {
    let current = this.context.parents.get(node);
    while (current && current !== fn) {
      if (
        isFunctionNode(current) ||
        current.type === 'ForStatement' ||
        current.type === 'ForInStatement' ||
        current.type === 'ForOfStatement' ||
        current.type === 'WhileStatement' ||
        current.type === 'DoWhileStatement'
      ) {
        return true;
      }
      current = this.context.parents.get(current);
    }
    return false;
  }

  /**
   * Finds the `merge()` and `omit()` views of the props declared in a
   * component's statements, and how each is used. A view can only be read
   * as `view.name`, spread onto an element, or passed to another view.
   * `undefined` when a view is used any other way.
   */
  private analyzeViews(
    fn: ComponentFunction,
    scope: Scope,
    statements: readonly Statement[],
    param: Binding | undefined,
  ):
    | {
        bindings: Set<Binding>;
        arguments: Set<Node>;
        declarations: Statement[];
        reads: ViewRead[];
        spreads: ViewSpread[];
      }
    | undefined {
    const views = new Map<Binding, View>();
    const args = new Set<Node>();
    const declarations: Statement[] = [];
    for (const statement of statements) {
      const declarator =
        statement.type === 'VariableDeclaration' ? statement.declarations.at(0) : undefined;
      if (
        statement.type !== 'VariableDeclaration' ||
        statement.kind !== 'const' ||
        statement.declarations.length !== 1 ||
        declarator?.id.type !== 'Identifier' ||
        !declarator.init
      ) {
        continue;
      }
      const init = unwrap(declarator.init);
      const callee = init.type === 'CallExpression' ? solidCallee(this.context, init) : undefined;
      if (init.type !== 'CallExpression' || (callee !== 'merge' && callee !== 'omit')) {
        continue;
      }
      const view = this.viewOf(callee, init, param, views, args);
      if (view === null) {
        continue;
      }
      const binding = scope.bindings.get(declarator.id.name);
      if (!view || !binding || binding.mutated) {
        return undefined;
      }
      views.set(binding, view);
      declarations.push(statement);
    }

    const reads: ViewRead[] = [];
    const spreads: ViewSpread[] = [];
    for (const [binding, view] of views) {
      for (const reference of binding.references) {
        if (args.has(reference)) {
          continue;
        }
        const parent = this.context.parents.get(reference);
        const opening = parent ? this.context.parents.get(parent) : undefined;
        const element = opening ? this.context.parents.get(opening) : undefined;
        if (
          parent?.type === 'JSXSpreadAttribute' &&
          opening?.type === 'JSXOpeningElement' &&
          element?.type === 'JSXElement'
        ) {
          spreads.push({
            attribute: parent,
            element,
            view,
            repeated: this.isRepeated(fn, parent),
          });
          continue;
        }
        const read = this.propRead(fn, reference);
        if (!read) {
          return undefined;
        }
        reads.push({ ...read, view });
      }
    }
    return { bindings: new Set(views.keys()), arguments: args, declarations, reads, spreads };
  }

  /**
   * The view a `merge()` or `omit()` call makes. `null` when it does not
   * take the props or another view, and `undefined` when it does but its
   * other arguments are not literal.
   */
  private viewOf(
    callee: 'merge' | 'omit',
    call: CallExpression,
    param: Binding | undefined,
    views: ReadonlyMap<Binding, View>,
    args: Set<Node>,
  ): View | null | undefined {
    const sourcesOf = (argument: Node): readonly ViewSource[] | undefined => {
      if (argument.type === 'CallExpression') {
        const nested = solidCallee(this.context, argument);
        if (nested !== 'merge' && nested !== 'omit') {
          return undefined;
        }
        return this.viewOf(nested, argument, param, views, args)?.sources;
      }
      if (argument.type !== 'Identifier') {
        return undefined;
      }
      const binding = this.context.scopes.references.get(argument);
      if (binding && binding === param) {
        return [{ defaults: undefined, hidden: new Set() }];
      }
      return binding ? views.get(binding)?.sources : undefined;
    };
    const involved = call.arguments.some(
      (argument) => argument.type !== 'SpreadElement' && sourcesOf(unwrap(argument)) !== undefined,
    );
    if (!involved) {
      return null;
    }

    if (callee === 'omit') {
      const first = call.arguments.at(0);
      const keys = call.arguments.slice(1);
      if (first === undefined || first.type === 'SpreadElement') {
        return undefined;
      }
      const target = unwrap(first);
      const base = sourcesOf(target);
      const hidden: string[] = [];
      for (const key of keys) {
        if (key.type !== 'Literal' || typeof key.value !== 'string') {
          return undefined;
        }
        hidden.push(key.value);
      }
      if (!base) {
        return undefined;
      }
      args.add(target);
      return {
        sources: base.map((source) => ({
          defaults: source.defaults,
          hidden: new Set([...source.hidden, ...hidden]),
        })),
      };
    }

    const sources: ViewSource[] = [];
    for (const argument of call.arguments) {
      if (argument.type === 'SpreadElement') {
        return undefined;
      }
      const inner = unwrap(argument);
      const existing = sourcesOf(inner);
      if (existing) {
        args.add(inner);
        sources.push(...existing);
        continue;
      }
      if (inner.type !== 'ObjectExpression') {
        return undefined;
      }
      const defaults = new Map<string, string>();
      for (const property of inner.properties) {
        if (property.type !== 'Property' || property.kind !== 'init' || property.computed) {
          return undefined;
        }
        let key: string;
        if (property.key.type === 'Identifier') {
          key = property.key.name;
        } else if (property.key.type === 'Literal' && typeof property.key.value === 'string') {
          key = property.key.value;
        } else {
          return undefined;
        }
        const value = evaluate(property.value, () => undefined);
        const text = value ? literalText(value.value) : undefined;
        if (text === undefined || isReservedPropName(key)) {
          return undefined;
        }
        defaults.set(key, text);
      }
      sources.push({ defaults, hidden: new Set() });
    }
    return { sources };
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
   * returned JSX of a component, with only intrinsic elements, fragments,
   * and closed providers between it and the call.
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
        const passable =
          name.type === 'JSXIdentifier' &&
          (isIntrinsicTag(name.name) || this.transparent.has(parent));
        if (!passable) {
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
    reads: readonly ReadCount[],
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
    reads: readonly ReadCount[],
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
    reads: readonly ReadCount[],
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

    // What each view read and spread resolves to at this call site.
    const views = this.resolveViews(component, attributes, hasChildren);
    if (!views) {
      return false;
    }

    // What each prop reads as.
    const snapshots: string[] = [];
    const fresh = (base: string): string => this.freshName(base);
    const readsByName = new Map<string, ReadCount[]>();
    const count = (name: string, read: ReadCount): void => {
      const reads = readsByName.get(name) ?? [];
      reads.push(read);
      readsByName.set(name, reads);
    };
    for (const read of views.propReads) {
      count(read.name, read);
    }
    for (const spread of views.spreads) {
      for (const [key, source] of spread.keys) {
        if (source === undefined) {
          count(key, spread.spread);
        }
      }
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

    const contextTexts = this.contextTexts(component, element);
    if (!contextTexts) {
      return false;
    }

    // Build the copy on the original code, so this pass's other edits stay out of it.
    const copy = new MagicString(this.context.code);
    this.renameLocals(copy, component, fresh);
    this.substituteProps(copy, views.propReads, values);
    this.substituteViews(copy, component, element, views, values);
    for (const [read, text] of contextTexts) {
      copy.overwrite(read.start, read.end, text);
    }

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

  /**
   * The context reads in a component's copy at `element` that a closed
   * provider above it answers, with the text each becomes. `undefined` when
   * a read cannot take the value there.
   */
  private contextTexts(component: Component, element: JSXElement): Map<Node, string> | undefined {
    const texts = new Map<Node, string>();
    for (const { provider, text } of this.answeringProviders(element)) {
      for (const read of contextReads(this.context, component.fn, provider.context)) {
        const value = text ?? stableValueText(this.context, provider, element);
        if (value === undefined) {
          return undefined;
        }
        texts.set(read, value);
      }
    }
    return texts;
  }

  /**
   * The closed providers that answer context reads at `element`. The nearest
   * provider of each context answers its reads, closed or not.
   */
  private answeringProviders(element: JSXElement): { provider: Provider; text?: string }[] {
    const answering: { provider: Provider; text?: string }[] = [];
    const seen = new Set<Binding>();
    for (
      let node = this.context.parents.get(element);
      node;
      node = this.context.parents.get(node)
    ) {
      const target =
        node.type === 'JSXElement'
          ? contextBinding(this.context, node.openingElement.name)
          : undefined;
      if (node.type !== 'JSXElement' || !target || seen.has(target)) {
        continue;
      }
      seen.add(target);
      const entry = this.transparent.get(node);
      if (entry) {
        answering.push(entry);
      }
    }
    return answering;
  }

  /**
   * Finds the providers statements can move out through: a subtree with
   * only visible code, where every component is one this pass can inline.
   * A value that is not a literal or a binding that never changes is
   * stored in a `const` of the host first, so every read gets the same one.
   */
  private findTransparentProviders(
    components: readonly Component[],
    sites: readonly CallSite[],
  ): Component[] {
    const byBinding = new Map(components.map((component) => [component.binding, component]));
    // Whether a subtree under `provider` only runs visible code, where each
    // component is one this pass inlines and is visible too.
    const closedUnder = (provider: Provider): ((node: Node) => boolean) => {
      const closedComponents = new Map<Component, boolean>();
      const options: ClosedOptions = {
        component: (element) => {
          const binding = this.context.scopes.references.get(element.openingElement.name);
          const component = binding ? byBinding.get(binding) : undefined;
          if (!component) {
            return false;
          }
          const known = closedComponents.get(component);
          if (known !== undefined) {
            return known;
          }
          // A component that renders itself is never closed.
          closedComponents.set(component, false);
          const closed = isClosed(this.context, component.fn, {
            ...options,
            props: component.param,
          });
          closedComponents.set(component, closed);
          return closed;
        },
        contextValue: (target) => (target === provider.context ? provider.value : undefined),
      };
      return (node) => isClosed(this.context, node, options);
    };

    const changed: Component[] = [];
    for (const provider of findProviders(this.context)) {
      const { element } = provider;
      const inside = sites.some(
        (site) => isWithin(site.element, element) && site.element !== element,
      );
      if (!inside) {
        continue;
      }
      const isClosedNode = closedUnder(provider);
      const closed = element.children.every((child) => isClosedNode(child));
      if (!closed) {
        continue;
      }
      if (stableValueText(this.context, provider, element) !== undefined) {
        this.transparent.set(element, { provider });
        continue;
      }
      const host = this.hostOf(element);
      if (!host) {
        continue;
      }
      const name = this.freshName(
        `${provider.context.name.charAt(0).toLowerCase()}${provider.context.name.slice(1)}Value`,
      );
      const entry = this.hosts.get(host.fn) ?? { host: host.host, texts: [] };
      entry.texts.push(`const ${name} = ${textOf(this.context, provider.value)};`);
      this.hosts.set(host.fn, entry);
      this.context.s.overwrite(provider.value.start, provider.value.end, name);
      this.transparent.set(element, { provider, text: name });
      this.changed = true;
      for (const component of components) {
        if (isWithin(element, component.fn)) {
          changed.push(component);
        }
      }
    }
    return changed;
  }

  /**
   * Resolves each view read and spread of a component at a call site. A
   * read becomes a read of the props, or the text of a default. A spread
   * becomes the keys it holds, in the order `merge()` gives them, and its
   * `children` become the element's children. `undefined` when a spread
   * repeats an attribute, or holds `children` for an element that has some.
   */
  private resolveViews(
    component: Component,
    attributes: ReadonlyMap<string, JSXAttribute>,
    hasChildren: boolean,
  ): ResolvedViews | undefined {
    const has = (key: string): boolean =>
      attributes.has(key) || (key === 'children' && hasChildren);
    // The last source that has the key answers, even when its value is `undefined`.
    const resolve = (view: View, key: string): string | undefined => {
      for (let index = view.sources.length - 1; index >= 0; index -= 1) {
        const source = view.sources.at(index);
        if (!source || source.hidden.has(key)) {
          continue;
        }
        const text = source.defaults?.get(key);
        if (text !== undefined) {
          return text;
        }
        if (!source.defaults && has(key)) {
          return undefined;
        }
      }
      return 'void 0';
    };

    const propReads: PropRead[] = [...component.props];
    const texts = new Map<Node, string>();
    for (const read of component.viewReads) {
      const text = resolve(read.view, read.name);
      if (text === undefined) {
        propReads.push(read);
      } else {
        texts.set(read.member, text);
      }
    }

    const callKeys = [...attributes.keys()];
    if (hasChildren && !attributes.has('children')) {
      callKeys.push('children');
    }
    const spreads: ResolvedSpread[] = [];
    const taken = new Map<JSXElement, Set<string>>();
    for (const spread of component.viewSpreads) {
      // A key sits where the last source that carries it puts it.
      const order: string[] = [];
      for (const source of spread.view.sources) {
        const keys = source.defaults ? [...source.defaults.keys()] : callKeys;
        for (const key of keys.filter((name) => !source.hidden.has(name))) {
          const index = order.indexOf(key);
          if (index !== -1) {
            order.splice(index, 1);
          }
          order.push(key);
        }
      }
      let names = taken.get(spread.element);
      if (!names) {
        names = new Set();
        for (const attribute of spread.element.openingElement.attributes) {
          if (attribute.type === 'JSXAttribute') {
            names.add(
              attribute.name.type === 'JSXIdentifier'
                ? attribute.name.name
                : textOf(this.context, attribute.name),
            );
          }
        }
        taken.set(spread.element, names);
      }
      const keys = new Map<string, string | undefined>();
      for (const key of order) {
        // Children become the element's children, so it must have none of its own.
        const fits =
          key === 'children'
            ? spread.element.openingElement.selfClosing
            : /^[A-Za-z_$][\w$-]*$/.test(key);
        if (!fits || names.has(key)) {
          return undefined;
        }
        names.add(key);
        keys.set(key, resolve(spread.view, key));
      }
      spreads.push({ spread, keys });
    }
    return { propReads, texts, spreads };
  }

  /**
   * Writes the resolved view reads and spreads into a copy, and drops the
   * view declarations.
   */
  private substituteViews(
    copy: MagicString,
    component: Component,
    element: JSXElement,
    views: ResolvedViews,
    values: ReadonlyMap<string, PropValue>,
  ): void {
    for (const [member, text] of views.texts) {
      const bare = text !== 'void 0' || acceptsAnyExpression(this.context, member);
      copy.overwrite(member.start, member.end, bare ? text : `(${text})`);
    }
    for (const { spread, keys } of views.spreads) {
      const parts: string[] = [];
      let children: string | undefined;
      for (const [key, text] of keys) {
        const value = values.get(key);
        if (key === 'children') {
          children = this.spreadChildren(element, text, value);
        } else {
          parts.push(`${key}={${text ?? value?.text ?? 'void 0'}}`);
        }
      }
      const { attribute } = spread;
      if (parts.length === 0) {
        copy.remove(attribute.start, attribute.end);
      } else {
        copy.overwrite(attribute.start, attribute.end, parts.join(' '));
      }
      if (children !== undefined) {
        const opening = spread.element.openingElement;
        const tag = textOf(this.context, opening.name);
        const close = this.context.code.lastIndexOf('/>', opening.end);
        copy.overwrite(close, opening.end, `>${children}</${tag}>`);
      }
    }
    for (const declaration of component.viewDeclarations) {
      copy.remove(declaration.start, declaration.end);
    }
  }

  /**
   * The JSX children a spread's `children` becomes: the call site's own
   * children, or the value of a single expression or default.
   */
  private spreadChildren(
    element: JSXElement,
    text: string | undefined,
    value: PropValue | undefined,
  ): string | undefined {
    if (text !== undefined) {
      return text === 'void 0' ? undefined : `{${text}}`;
    }
    if (!value) {
      return undefined;
    }
    if (value.kind === 'children' && element.closingElement) {
      return this.context.s.slice(element.openingElement.end, element.closingElement.start);
    }
    return `{${value.text}}`;
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
    reads: readonly PropRead[],
    values: ReadonlyMap<string, PropValue>,
  ): void {
    // Reads that are a JSX child on their own, like `{props.children}`,
    // splice their JSX in place. They are grouped by parent so neighboring
    // text stays apart.
    const spliced = new Map<JSXElement | JSXFragment, Map<JSXChild, Piece>>();
    for (const read of reads) {
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
    const changedBodies = new Set<Component>(this.findTransparentProviders(components, sites));
    for (const site of inBodyOrder(sites)) {
      const postponed = changedBodies.has(site.component);
      const done = !postponed && this.inline(site.component, site.element);
      if (done) {
        this.changed = true;
        const elements = inlined.get(site.component) ?? [];
        elements.push(site.element);
        inlined.set(site.component, elements);
      } else {
        otherUses.set(site.component, (otherUses.get(site.component) ?? 0) + 1);
      }
      // A component holding a call that was inlined now, or postponed to the
      // next pass, waits too. A copy made now would copy the call as it is.
      if (done || postponed) {
        for (const component of components) {
          if (isWithin(site.element, component.fn)) {
            changedBodies.add(component);
          }
        }
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
