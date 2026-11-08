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
 *   name, as a function declaration or a `const` bound to a function. A
 *   tag of an alias, like `const Separator = SeparatorRoot`, is renamed to
 *   the component first. See `renameAliasTags`.
 * - It takes no parameter, or one identifier that is only read as `props.name`,
 *   or spread onto an element as `{...props}`.
 * - Its body is statements followed by one final `return` of JSX, or an arrow
 *   function whose body is JSX.
 * - It does not use `this`, `arguments`, `new.target`, or `super`.
 *
 * A call site inlines when it passes plain attributes: no spread and no
 * namespaced attribute. A `ref` moves to the element the component forwards
 * `props.ref` to. See `refValue`.
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
 * the function whose returned JSX holds the call, when that function also
 * runs untracked:
 *
 * - a component;
 * - the child callback of `<For>` or `<Repeat>`, which runs once per item
 *   under its own owner;
 * - the child callback of `<Show>` or `<Match>` that takes the value, which
 *   runs once each time the condition turns true;
 * - the callback given to `render`, which runs once under its root.
 *
 * The call has to be in that returned JSX with only intrinsic elements and
 * fragments around it, so it is created exactly once each time that function
 * runs.
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
import type {
  ArrayExpressionElement,
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
  ObjectPropertyKind,
  ReturnStatement,
  Statement,
  VariableDeclarator,
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
import { getText, isConstantDeclaration, recordSkip, solidExport } from './context';
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
import { keptPiece, replacedPiece, splicePiece, writePieces } from './jsx';
import type { Binding, Scope } from './scope';
import { isWithinScope, lookup, scopeAt } from './scope';
import { copySize } from './copy-size';
import { SizeEstimator } from './size';
import { evaluate, literalText } from './value';
import type { Content, Editor, Text } from './text';
import { getCode, join, joinText } from './text';

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
  readonly defaults: ReadonlyMap<string, Text> | undefined;
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
  readonly keys: ReadonlyMap<string, Content | undefined>;
}

interface ResolvedViews {
  /** Reads of the props, including view reads the props answer. */
  readonly propReads: readonly PropRead[];
  /** View reads a default or nothing answers, and their text. */
  readonly texts: ReadonlyMap<Node, Content>;
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

/** A copy of a component, ready to replace a call site. */
interface PreparedSite {
  readonly element: JSXElement;
  /** Where the statements go, when there are any. */
  readonly host: { fn: Node; host: Host } | undefined;
  readonly statements: Content[];
  readonly root: Text;
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
    const ready: CallSite[] = [];
    for (const site of pending) {
      if (!hasPendingDependency(pending, site)) {
        ready.push(site);
      }
    }
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
  | { readonly kind: 'expression'; readonly text: Content; readonly primary: boolean }
  /** JSX, spliced in place when read as a JSX child. */
  | { readonly kind: 'jsx'; readonly text: Content; readonly primary: boolean }
  /** JSX children, spliced in place when read as a JSX child. */
  | {
      readonly kind: 'children';
      readonly children: readonly JSXChild[];
      readonly text: Content;
      readonly primary: boolean;
    };

const UNDEFINED: PropValue = { kind: 'expression', text: 'void 0', primary: false };

/** The function a copy is wrapped in when it is measured. See `copy-size.ts`. */
const COPY_WRAPPER = 'function SoSize$$(';

/** Whether code has a JSX tag named `name`. */
function hasTag(code: string, name: string): boolean {
  return new RegExp(`<${name.replaceAll('$', String.raw`\$`)}[\\s/>]`).test(code);
}

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
 * Collects the nodes an assignment target writes through: an identifier, or
 * the root of a member chain, like `cache` in `cache.items[0] = x`. A root
 * that is not a name, like a call, is collected as it is.
 */
function collectWriteRoots(target: Node, roots: Node[]): void {
  switch (target.type) {
    case 'MemberExpression':
      collectWriteRoots(target.object, roots);
      break;
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'TSTypeAssertion':
      collectWriteRoots(target.expression, roots);
      break;
    case 'ObjectPattern':
      for (const property of target.properties) {
        collectWriteRoots(
          property.type === 'RestElement' ? property.argument : property.value,
          roots,
        );
      }
      break;
    case 'ArrayPattern':
      for (const element of target.elements) {
        if (element) {
          collectWriteRoots(element, roots);
        }
      }
      break;
    case 'AssignmentPattern':
      collectWriteRoots(target.left, roots);
      break;
    case 'RestElement':
      collectWriteRoots(target.argument, roots);
      break;
    default:
      roots.push(target);
      break;
  }
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
function findComponentFunction(
  binding: Binding,
  options: ResolvedOptions,
): ComponentFunction | undefined {
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
function getAttributes(
  context: PassContext,
  element: JSXElement,
): Map<string, JSXAttribute> | undefined {
  const attributes = new Map<string, JSXAttribute>();
  for (const attribute of element.openingElement.attributes) {
    // A spread can supply any prop, and a namespaced attribute is something
    // the JSX transform handles on its own.
    if (
      attribute.type !== 'JSXAttribute' ||
      attribute.name.type !== 'JSXIdentifier' ||
      (attribute.name.name === 'ref' && !isForwardableRef(context, attribute)) ||
      attributes.has(attribute.name.name)
    ) {
      return undefined;
    }
    attributes.set(attribute.name.name, attribute);
  }
  return attributes;
}

/**
 * Whether a top-level statement declares only constants made of literals,
 * like `const ROWS = [{ name: 'a' }]`. An export keeps its `export`, since
 * the fold pass treats an exported list differently.
 */
function isDataDeclaration(statement: Node): boolean {
  const declaration =
    statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
  return (
    declaration?.type === 'VariableDeclaration' &&
    !declaration.declare &&
    (declaration.kind === 'const' || declaration.kind === 'var') &&
    areDataDeclarators(declaration.declarations)
  );
}

/** Whether an expression is a literal, or an array or object literal of them. */
function isDataLiteral(node: Expression): boolean {
  switch (node.type) {
    case 'Literal':
      return !('regex' in node);
    case 'TemplateLiteral':
      return node.expressions.length === 0;
    case 'UnaryExpression':
      return node.operator === '-' && node.argument.type === 'Literal';
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return isDataLiteral(node.expression);
    case 'ArrayExpression':
      return areDataElements(node.elements);
    case 'ObjectExpression':
      return areDataProperties(node.properties);
    default:
      return false;
  }
}

function isMemberRead(read: ReadCount): read is PropRead {
  return 'member' in read;
}

/**
 * Whether a `ref` at a call site can move to the element the component
 * forwards it to: a name, a function, or an array of them. A name is
 * assigned the element, so it has to stay the name itself. Anything else
 * would be evaluated when the element is made, outside the `untrack` the
 * component's `ref` runs it in.
 *
 * Inside an array, `void 0` and `untrack(() => target)` count too. Solid
 * skips an empty entry of a ref array, and evaluates the whole `ref`
 * untracked. They come from a component that forwards `props.ref` in an
 * array, once a call site that passes no `ref` is inlined.
 */
function isForwardableRef(context: PassContext, attribute: JSXAttribute): boolean {
  const { value } = attribute;
  if (value?.type !== 'JSXExpressionContainer' || value.expression.type === 'JSXEmptyExpression') {
    return false;
  }
  const isTarget = (node: Expression, inArray: boolean): boolean => {
    const inner = unwrap(node);
    if (inner.type === 'ArrayExpression') {
      for (const element of inner.elements) {
        if (element === null || element.type === 'SpreadElement' || !isTarget(element, true)) {
          return false;
        }
      }
      return true;
    }
    if (inArray && isVoidZero(inner)) {
      return true;
    }
    if (inArray && inner.type === 'CallExpression' && solidCallee(context, inner) === 'untrack') {
      const callback = inner.arguments.at(0);
      return (
        inner.arguments.length === 1 &&
        callback?.type === 'ArrowFunctionExpression' &&
        callback.expression &&
        callback.params.length === 0 &&
        callback.body.type !== 'BlockStatement' &&
        isTarget(callback.body, true)
      );
    }
    return (
      inner.type === 'Identifier' ||
      inner.type === 'ArrowFunctionExpression' ||
      inner.type === 'FunctionExpression'
    );
  };
  return isTarget(value.expression, false);
}

/** Whether an expression is `void 0`. */
function isVoidZero(node: Expression): boolean {
  return (
    node.type === 'UnaryExpression' &&
    node.operator === 'void' &&
    node.argument.type === 'Literal' &&
    node.argument.value === 0
  );
}

/**
 * Why `getAttributes` turns down a call site, for the report.
 */
function callSiteReason(element: JSXElement): string {
  const names = new Set<string>();
  for (const attribute of element.openingElement.attributes) {
    if (attribute.type !== 'JSXAttribute') {
      return 'call-spread';
    }
    if (attribute.name.type !== 'JSXIdentifier') {
      return 'call-namespace';
    }
    if (attribute.name.name === 'ref') {
      return 'call-ref';
    }
    if (names.has(attribute.name.name)) {
      break;
    }
    names.add(attribute.name.name);
  }
  return 'call-duplicate';
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

  private readonly hosts = new Map<Node, { host: Host; texts: Content[] }>();

  /**
   * Providers whose subtree is closed, so statements can move out through
   * them. Each maps to the text its reads become, or `undefined` when a
   * binding that never changes is read at each site.
   */
  private readonly transparent = new Map<JSXElement, { provider: Provider; text?: Content }>();

  constructor(private readonly context: PassContext) {}

  /** Why the last component or call site was turned down, for the report. */
  private reason = '';

  /**
   * Whether a binding holds a component made by Solid's `lazy`, for the
   * report. In a chunk, `lazy` can be a local declaration under another
   * name, so a call given a function with a dynamic import counts too.
   */
  private isLazy(binding: Binding): boolean {
    const { declaration } = binding;
    const init =
      declaration.type === 'VariableDeclarator' && declaration.init
        ? unwrap(declaration.init)
        : undefined;
    if (init?.type !== 'CallExpression' || init.callee.type !== 'Identifier') {
      return false;
    }
    const callee = this.context.scopes.references.get(init.callee);
    if (callee && solidExport(callee, this.context.options) === 'lazy') {
      return true;
    }
    const loader = init.arguments.at(0);
    if (!loader || !isFunctionNode(loader)) {
      return false;
    }
    let imports = false;
    const visit = (node: Node): void => {
      if (node.type === 'ImportExpression') {
        imports = true;
      }
      if (!imports) {
        forEachChild(node, visit);
      }
    };
    visit(loader);
    return imports;
  }

  // ---------------------------------------------------------------------------
  // Components
  // ---------------------------------------------------------------------------

  private getScope(fn: ComponentFunction): Scope | undefined {
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

  /**
   * Whether statements assign, update, or delete through a binding declared
   * outside `scope`, or through a global. Writes inside nested functions
   * count too, since a function can run right away, like a memo's.
   */
  private writesOutside(statements: readonly Statement[], scope: Scope): boolean {
    const roots: Node[] = [];
    const visit = (node: Node): void => {
      if (node.type === 'AssignmentExpression') {
        collectWriteRoots(node.left, roots);
      } else if (node.type === 'UpdateExpression') {
        collectWriteRoots(node.argument, roots);
      } else if (node.type === 'UnaryExpression' && node.operator === 'delete') {
        collectWriteRoots(node.argument, roots);
      }
      forEachChild(node, visit);
    };
    for (const statement of statements) {
      visit(statement);
    }
    for (const root of roots) {
      if (root.type !== 'Identifier') {
        return true;
      }
      const target = this.context.scopes.references.get(root);
      if (!target || !isWithinScope(target.scope, scope)) {
        return true;
      }
    }
    return false;
  }

  private analyzeComponent(binding: Binding): Component | undefined {
    if (!isCapitalized(binding.name)) {
      return undefined;
    }
    if (binding.mutated) {
      this.reason = 'component-mutated';
      return undefined;
    }
    const fn = findComponentFunction(binding, this.context.options);
    if (!fn?.body) {
      this.reason = this.isLazy(binding) ? 'lazy' : 'not-a-function';
      return undefined;
    }
    if (fn.async || fn.generator) {
      this.reason = 'component-async';
      return undefined;
    }
    if (fn.params.length > 1) {
      this.reason = 'component-params';
      return undefined;
    }
    const scope = this.getScope(fn);
    if (!scope) {
      this.reason = 'not-a-function';
      return undefined;
    }

    // The body: statements, then one `return` of JSX.
    let statements: Statement[] = [];
    let root: Expression;
    if (fn.body.type === 'BlockStatement') {
      const body = fn.body.body;
      const last = body.at(-1);
      if (last?.type !== 'ReturnStatement' || !last.argument) {
        this.reason = 'component-body';
        return undefined;
      }
      const rest: Statement[] = [];
      for (const statement of body.slice(0, -1)) {
        // A directive like `"use strict"` changes how the body runs.
        // TypeScript's AST gives every expression statement a `directive`
        // key, which is `null` unless the statement is a directive.
        const directive = 'directive' in statement ? statement.directive : null;
        if (typeof directive === 'string') {
          this.reason = 'component-directive';
          return undefined;
        }
        if (containsReturn(statement)) {
          this.reason = 'component-return';
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
      this.reason = 'component-body';
      return undefined;
    }
    if (usesFunctionContext(this.context, fn.body)) {
      this.reason = 'component-this';
      return undefined;
    }
    // A copy's statements run before any JSX of the function they move into,
    // so JSX there could read a value they write later than it should.
    if (this.writesOutside(statements, scope)) {
      this.reason = 'component-write';
      return undefined;
    }

    // The parameter is only read as `props.name`.
    const param = fn.params.at(0);
    let paramBinding: Binding | undefined;
    if (param) {
      if (param.type !== 'Identifier') {
        this.reason = 'component-params';
        return undefined;
      }
      paramBinding = scope.bindings.get(param.name);
      if (!paramBinding || paramBinding.mutated) {
        this.reason = 'props-use';
        return undefined;
      }
    }
    const views = this.analyzeViews(fn, scope, statements, paramBinding);
    if (!views) {
      this.reason = 'view-use';
      return undefined;
    }
    const props: PropRead[] = [];
    for (const reference of paramBinding?.references ?? []) {
      if (views.arguments.has(reference)) {
        continue;
      }
      const read = this.propRead(fn, reference);
      if (!read) {
        this.reason = 'props-use';
        return undefined;
      }
      props.push(read);
    }
    const kept: typeof statements = [];
    for (const statement of statements) {
      if (!views.declarations.includes(statement)) {
        kept.push(statement);
      }
    }
    statements = kept;

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
        this.reason = 'component-recursive';
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
      const view = this.resolveView(callee, init, param, views, args);
      if (view === null) {
        continue;
      }
      // A body with its own scope (a parameter has a default) holds the declaration.
      const body = (fn.body && this.context.scopes.scopes.get(fn.body)) ?? scope;
      const binding = body.bindings.get(declarator.id.name);
      if (!view || !binding || binding.mutated) {
        return undefined;
      }
      views.set(binding, view);
      declarations.push(statement);
    }

    const reads: ViewRead[] = [];
    const spreads: ViewSpread[] = [];
    // `{...props}` spreads every prop, like a view of the props with nothing hidden.
    const whole: View = { sources: [{ defaults: undefined, hidden: new Set() }] };
    for (const reference of param?.references ?? []) {
      const spread = this.spreadOnElement(reference);
      if (spread) {
        args.add(reference);
        spreads.push({
          attribute: spread.attribute,
          element: spread.element,
          view: whole,
          repeated: this.isRepeated(fn, spread.attribute),
        });
      }
    }
    for (const [binding, view] of views) {
      for (const reference of binding.references) {
        if (args.has(reference)) {
          continue;
        }
        const spread = this.spreadOnElement(reference);
        if (spread) {
          spreads.push({
            attribute: spread.attribute,
            element: spread.element,
            view,
            repeated: this.isRepeated(fn, spread.attribute),
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

  /** The spread a reference is the whole argument of, and the element it is on. */
  private spreadOnElement(
    reference: Node,
  ): { attribute: JSXSpreadAttribute; element: JSXElement } | undefined {
    const parent = this.context.parents.get(reference);
    const opening = parent ? this.context.parents.get(parent) : undefined;
    const element = opening ? this.context.parents.get(opening) : undefined;
    return parent?.type === 'JSXSpreadAttribute' &&
      opening?.type === 'JSXOpeningElement' &&
      element?.type === 'JSXElement'
      ? { attribute: parent, element }
      : undefined;
  }

  /**
   * The view a `merge()` or `omit()` call makes. `null` when it does not
   * take the props or another view, and `undefined` when it does but its
   * other arguments are not literal.
   */
  private resolveView(
    callee: 'merge' | 'omit',
    call: CallExpression,
    param: Binding | undefined,
    views: ReadonlyMap<Binding, View>,
    args: Set<Node>,
  ): View | null | undefined {
    const resolveSources = (argument: Node): readonly ViewSource[] | undefined => {
      if (argument.type === 'CallExpression') {
        const nested = solidCallee(this.context, argument);
        if (nested !== 'merge' && nested !== 'omit') {
          return undefined;
        }
        return this.resolveView(nested, argument, param, views, args)?.sources;
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
    let involved = false;
    for (const argument of call.arguments) {
      if (argument.type !== 'SpreadElement' && resolveSources(unwrap(argument)) !== undefined) {
        involved = true;
        break;
      }
    }
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
      const base = resolveSources(target);
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
      const hiddenSources: ViewSource[] = [];
      for (const source of base) {
        hiddenSources.push({
          defaults: source.defaults,
          hidden: new Set([...source.hidden, ...hidden]),
        });
      }
      return { sources: hiddenSources };
    }

    const sources: ViewSource[] = [];
    for (const argument of call.arguments) {
      if (argument.type === 'SpreadElement') {
        return undefined;
      }
      const inner = unwrap(argument);
      const existing = resolveSources(inner);
      if (existing) {
        args.add(inner);
        sources.push(...existing);
        continue;
      }
      if (inner.type !== 'ObjectExpression') {
        return undefined;
      }
      const defaults = new Map<string, Text>();
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
        defaults.set(key, this.context.s.written(text, property.value.start));
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
   * Whether a function runs untracked, once each time the JSX it returns is
   * created, so it can take a component's statements. See "Where a component
   * body can go" above.
   */
  private isHostFunction(fn: Node): boolean {
    if (this.isComponentFunction(fn)) {
      return true;
    }
    if (
      (fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression') ||
      fn.async ||
      fn.generator
    ) {
      return false;
    }
    let node: Node = fn;
    let parent = this.context.parents.get(node);
    while (parent?.type === 'ParenthesizedExpression') {
      node = parent;
      parent = this.context.parents.get(node);
    }
    // `render(() => <App />, element)` calls it once under a new root.
    if (parent?.type === 'CallExpression') {
      return parent.arguments.at(0) === node && this.solidCallee(parent.callee) === 'render';
    }
    // A built-in's only child.
    const element =
      parent?.type === 'JSXExpressionContainer' ? this.context.parents.get(parent) : undefined;
    if (element?.type !== 'JSXElement') {
      return false;
    }
    const significant = getSignificantChildren(element.children);
    if (significant.length !== 1 || significant.at(0) !== parent) {
      return false;
    }
    switch (this.solidCallee(element.openingElement.name)) {
      case 'For':
      case 'Repeat':
        return true;
      // These only call a callback that takes the value. One without a parameter is a child to insert.
      case 'Show':
      case 'Match':
        return fn.params.length > 0;
      default:
        return false;
    }
  }

  /** The Solid export a callee or tag refers to. */
  private solidCallee(name: Node): string | undefined {
    if (name.type !== 'Identifier' && name.type !== 'JSXIdentifier') {
      return undefined;
    }
    const { references } = this.context.scopes;
    if (!references.has(name)) {
      return undefined;
    }
    const binding = references.get(name);
    return binding ? solidExport(binding, this.context.options) : undefined;
  }

  /**
   * Where the statements of a component created at `element` can go: the
   * returned JSX of a component, with only intrinsic elements, fragments,
   * and closed providers between it and the call.
   */
  private findHost(element: JSXElement): { fn: Node; host: Host } | undefined {
    let node: Node = element;
    for (;;) {
      const parent = this.context.parents.get(node);
      if (!parent) {
        return undefined;
      }
      if (parent.type === 'JSXElement') {
        const { name } = parent.openingElement;
        const passable =
          this.assumedHosts?.has(parent) === true ||
          (name.type === 'JSXIdentifier' &&
            (isIntrinsicTag(name.name) || this.transparent.has(parent)));
        if (!passable) {
          return undefined;
        }
        const child = node;
        if (!hasChild(parent.children, child)) {
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
        if (!fn || !this.isHostFunction(fn)) {
          return undefined;
        }
        return { fn, host: { kind: 'return', statement: parent } };
      } else if (parent.type === 'ArrowFunctionExpression') {
        if (parent.body !== node || !this.isHostFunction(parent)) {
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
    snapshots: Content[],
  ): PropValue | undefined {
    const { children } = element;
    if (hasSpreadChild(children)) {
      return undefined;
    }
    const significant = getSignificantChildren(children);
    const only = significant.at(0);
    if (only === undefined) {
      return { kind: 'children', children: [], text: 'void 0', primary: false };
    }
    let text: Content;
    let primary = true;
    if (significant.length > 1 || only.type === 'JSXText') {
      text = joinText`<>${this.context.s.slice(element.openingElement.end, element.closingElement?.start ?? element.end)}</>`;
    } else if (only.type === 'JSXExpressionContainer') {
      if (only.expression.type === 'JSXEmptyExpression') {
        return undefined;
      }
      // A single expression is passed like an attribute value, such as a
      // render function that has to stay one function.
      const value = this.expressionValue(only.expression, 'children', reads, fresh, snapshots);
      if (
        value.kind !== 'expression' ||
        getCode(value.text) !== getText(this.context, only.expression).code
      ) {
        return value;
      }
      text = value.text;
      primary = value.primary;
    } else {
      text = getText(this.context, only);
    }
    return { kind: 'children', children, text, primary };
  }

  /**
   * How a `ref` from the call site reads in a copy. Solid passes a `ref` to
   * a component as a function that sets the call site's ref to the element
   * it is given. The component applies it with its own `ref`, which runs
   * while the element is made, so the call site's `ref` can move to that
   * element. Every read has to be the whole `ref` of an element or of
   * another component, or a key of a spread, which becomes one.
   */
  private refValue(
    attribute: JSXAttribute | undefined,
    reads: readonly ReadCount[],
  ): PropValue | undefined {
    const value = attribute?.value;
    if (
      value?.type !== 'JSXExpressionContainer' ||
      value.expression.type === 'JSXEmptyExpression'
    ) {
      return undefined;
    }
    for (const read of reads) {
      if (!isMemberRead(read)) {
        continue;
      }
      const container = this.context.parents.get(read.member);
      const owner = container ? this.context.parents.get(container) : undefined;
      if (
        container?.type !== 'JSXExpressionContainer' ||
        owner?.type !== 'JSXAttribute' ||
        owner.name.type !== 'JSXIdentifier' ||
        owner.name.name !== 'ref'
      ) {
        return undefined;
      }
    }
    return { kind: 'expression', text: getText(this.context, value.expression), primary: true };
  }

  /**
   * How a prop reads in a copy of the component, and the `const` that stores
   * it first when the value has to be evaluated once.
   */
  private propValue(
    attribute: JSXAttribute | undefined,
    reads: readonly ReadCount[],
    fresh: (base: string) => string,
    snapshots: Content[],
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
        return {
          kind: 'expression',
          text: this.context.s.written(JSON.stringify(value.value), value.start),
          primary: true,
        };
      case 'JSXElement':
      case 'JSXFragment':
        return { kind: 'jsx', text: getText(this.context, value), primary: true };
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
    snapshots: Content[],
  ): PropValue {
    const text = getText(this.context, expression);
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
    snapshots.push(joinText`const ${local} = ${text};`);
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

  /** The names `freshName` takes from while copies are only measured. */
  private scratchNames: Set<string> | undefined;

  /**
   * Component calls measured as if they were inlined already, so the calls
   * in their children can hoist statements through them.
   */
  private assumedHosts: ReadonlySet<JSXElement> | undefined;

  private freshName(name: string): string {
    const names = this.scratchNames ?? this.context.scopes.names;
    // A name a copy gave out before, like `theme$1`, is renamed from `theme` again.
    const base = name.replace(/\$\d+$/, '');
    let index = 1;
    let fresh = `${base}$${String(index)}`;
    while (names.has(fresh)) {
      index += 1;
      fresh = `${base}$${String(index)}`;
    }
    names.add(fresh);
    return fresh;
  }

  /**
   * The copy of `component` that would replace `element`, or `undefined`
   * when it cannot be inlined there. Nothing is written until `commit`.
   */
  private prepare(component: Component, element: JSXElement): PreparedSite | undefined {
    const attributes = getAttributes(this.context, element);
    if (!attributes) {
      this.reason = callSiteReason(element);
      return undefined;
    }
    const hasChildren = getSignificantChildren(element.children).length > 0;
    if (hasChildren && attributes.has('children')) {
      this.reason = 'call-children';
      return undefined;
    }
    for (const attribute of attributes.values()) {
      if (attribute.value && usesFunctionContext(this.context, attribute.value)) {
        this.reason = 'call-this';
        return undefined;
      }
    }
    for (const child of element.children) {
      if (usesFunctionContext(this.context, child)) {
        this.reason = 'call-this';
        return undefined;
      }
    }

    // What each view read and spread resolves to at this call site.
    const views = this.resolveViews(component, attributes, hasChildren);
    if (!views) {
      this.reason = 'view-conflict';
      return undefined;
    }

    // What each prop reads as.
    const snapshots: Content[] = [];
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
      } else if (name === 'ref' && attributes.has('ref')) {
        value = this.refValue(attributes.get('ref'), reads);
      } else {
        value = this.propValue(attributes.get(name), reads, fresh, snapshots);
      }
      if (!value) {
        // A `ref` is turned down when the component uses it other than as a `ref`.
        this.reason = name === 'ref' && attributes.has('ref') ? 'ref-use' : 'prop-value';
        return undefined;
      }
      values.set(name, value);
    }

    // The component's outer references must mean the same at the call site.
    const scope = scopeAt(this.context.scopes, this.context.parents, element);
    for (const reference of component.outer) {
      if (lookup(scope, reference.name) !== reference.binding) {
        this.reason = 'shadowed';
        return undefined;
      }
    }

    const hoisted = component.statements.length > 0 || snapshots.length > 0;
    const host = hoisted ? this.findHost(element) : undefined;
    if (hoisted && !host) {
      this.reason = 'no-host';
      return undefined;
    }

    const contextTexts = this.contextTexts(component, element);
    if (!contextTexts) {
      this.reason = 'context-value';
      return undefined;
    }

    // Build the copy on the original code, so this pass's other edits stay out of it.
    const copy = this.context.s.fresh();
    this.renameLocals(copy, component, fresh);
    this.substituteProps(copy, views.propReads, values);
    this.substituteViews(copy, component, element, views, values);
    for (const [read, text] of contextTexts) {
      copy.overwrite(read.start, read.end, text);
    }

    const statements = [...snapshots];
    const first = component.statements.at(0);
    const last = component.statements.at(-1);
    if (first && last) {
      // The last statement can rely on a line break that it loses here.
      const text = copy.slice(first.start, last.end);
      statements.push(text.code.endsWith(';') ? text : joinText`${text};`);
    }
    return {
      element,
      host,
      statements,
      root: copy.slice(component.root.start, component.root.end),
    };
  }

  /** Queues statements for a host. Each `return` gets its own, since their scopes can differ. */
  private addToHost(found: { fn: Node; host: Host }, texts: readonly Content[]): void {
    const key = found.host.kind === 'return' ? found.host.statement : found.fn;
    const entry = this.hosts.get(key) ?? { host: found.host, texts: [] };
    entry.texts.push(...texts);
    this.hosts.set(key, entry);
  }

  /**
   * Writes a prepared copy over its call site.
   */
  private commit(site: PreparedSite): void {
    this.context.s.overwrite(site.element.start, site.element.end, site.root);
    if (site.host) {
      this.addToHost(site.host, site.statements);
    }
  }

  /**
   * The context reads in a component's copy at `element` that a closed
   * provider above it answers, with the text each becomes. `undefined` when
   * a read cannot take the value there.
   */
  private contextTexts(component: Component, element: JSXElement): Map<Node, Content> | undefined {
    const texts = new Map<Node, Content>();
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
  private answeringProviders(element: JSXElement): { provider: Provider; text?: Content }[] {
    const answering: { provider: Provider; text?: Content }[] = [];
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
    const byBinding = new Map<Binding, Component>();
    for (const component of components) {
      byBinding.set(component.binding, component);
    }
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
      const inside = hasSiteInside(sites, element);
      if (!inside) {
        continue;
      }
      const isClosedNode = closedUnder(provider);
      let closed = true;
      for (const child of element.children) {
        if (!isClosedNode(child)) {
          closed = false;
          break;
        }
      }
      if (!closed) {
        continue;
      }
      if (stableValueText(this.context, provider, element) !== undefined) {
        this.transparent.set(element, { provider });
        continue;
      }
      const host = this.findHost(element);
      if (!host) {
        continue;
      }
      const name = this.freshName(
        `${provider.context.name.charAt(0).toLowerCase()}${provider.context.name.slice(1)}Value`,
      );
      this.addToHost(host, [joinText`const ${name} = ${getText(this.context, provider.value)};`]);
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
    const resolve = (view: View, key: string): Content | undefined => {
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
    const texts = new Map<Node, Content>();
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
        for (const key of keys) {
          if (source.hidden.has(key)) {
            continue;
          }
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
                : getText(this.context, attribute.name).code,
            );
          }
        }
        taken.set(spread.element, names);
      }
      const keys = new Map<string, Content | undefined>();
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
    copy: Editor,
    component: Component,
    element: JSXElement,
    views: ResolvedViews,
    values: ReadonlyMap<string, PropValue>,
  ): void {
    for (const [member, text] of views.texts) {
      const bare = getCode(text) !== 'void 0' || acceptsAnyExpression(this.context, member);
      copy.overwrite(member.start, member.end, bare ? text : joinText`(${text})`);
    }
    for (const { spread, keys } of views.spreads) {
      const parts: Text[] = [];
      let children: Content | undefined;
      for (const [key, text] of keys) {
        const value = values.get(key);
        if (key === 'children') {
          children = this.spreadChildren(element, text, value);
        } else {
          parts.push(joinText`${key}={${text ?? value?.text ?? 'void 0'}}`);
        }
      }
      const { attribute } = spread;
      if (parts.length === 0) {
        copy.remove(attribute.start, attribute.end);
      } else {
        copy.overwrite(attribute.start, attribute.end, join(parts, ' '));
      }
      if (children !== undefined) {
        const opening = spread.element.openingElement;
        // Read the tag from the copy, which holds the renamed locals.
        const tag = copy.slice(opening.name.start, opening.name.end);
        const close = this.context.code.lastIndexOf('/>', opening.end);
        copy.overwrite(close, opening.end, joinText`>${children}</${tag}>`);
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
    text: Content | undefined,
    value: PropValue | undefined,
  ): Content | undefined {
    if (text !== undefined) {
      return getCode(text) === 'void 0' ? undefined : joinText`{${text}}`;
    }
    if (!value) {
      return undefined;
    }
    if (value.kind === 'children' && element.closingElement) {
      return this.context.s.slice(element.openingElement.end, element.closingElement.start);
    }
    return joinText`{${value.text}}`;
  }

  private renameLocals(copy: Editor, component: Component, fresh: (base: string) => string): void {
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
    copy: Editor,
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
      copy.overwrite(
        read.member.start,
        read.member.end,
        bare ? value.text : joinText`(${value.text})`,
      );
    }
    for (const [parent, pieces] of spliced) {
      const children: Piece[] = [];
      for (const child of parent.children) {
        children.push(pieces.get(child) ?? keptPiece(child));
      }
      writePieces(copy, children);
    }
  }

  private splicedPiece(container: JSXExpressionContainer, value: PropValue): Piece {
    if (value.kind === 'children') {
      return splicePiece(this.context.s, container, value.children);
    }
    return replacedPiece(container, value.text);
  }

  // ---------------------------------------------------------------------------
  // Pass
  // ---------------------------------------------------------------------------

  /**
   * The components worth inlining in this pass: those whose copies are no
   * larger than what they replace, which is their calls, and their
   * declaration when nothing else uses it.
   */
  private worthwhileComponents(
    sites: readonly CallSite[],
    postponed: ReadonlySet<Component>,
    otherUses: ReadonlyMap<Component, number>,
  ): Set<Component> {
    const byComponent = new Map<Component, JSXElement[]>();
    for (const site of sites) {
      if (!postponed.has(site.component)) {
        const elements = byComponent.get(site.component) ?? [];
        elements.push(site.element);
        byComponent.set(site.component, elements);
      }
    }
    const result = new Set<Component>();
    const { alwaysInline, alwaysInlineComponents } = this.context.options;
    for (const component of byComponent.keys()) {
      if (alwaysInline || alwaysInlineComponents.has(component.binding.name)) {
        result.add(component);
        byComponent.delete(component);
      }
    }
    if (byComponent.size === 0) {
      return result;
    }
    // The copies made here are only measured, so their fresh names are not kept.
    this.scratchNames = new Set(this.context.scopes.names);
    try {
      const copiesOf = new Map<Component, Map<JSXElement, PreparedSite | undefined>>();
      for (const [component, elements] of byComponent) {
        const prepared = new Map<JSXElement, PreparedSite | undefined>();
        for (const element of elements) {
          prepared.set(element, this.prepare(component, element));
        }
        copiesOf.set(component, prepared);
      }
      this.sites = sites;
      this.otherUses = otherUses;
      this.blocked = new Map();
      for (const [inner, byElement] of copiesOf) {
        for (const [element, copy] of byElement) {
          const outer = copy ? undefined : findOuterComponent(this.components, inner, element);
          if (outer) {
            const list = this.blocked.get(outer) ?? [];
            list.push(inner);
            this.blocked.set(outer, list);
          }
        }
      }
      for (const [component, byElement] of copiesOf) {
        const copies = collectPrepared(byElement.values());
        if (copies.length === 0) {
          continue;
        }
        const gain =
          this.inliningGain(component, copies, this.removedShare(component, byElement, otherUses)) +
          this.enabledGain(component, copies, copiesOf, otherUses);
        if (gain >= 0) {
          result.add(component);
        }
      }
    } finally {
      this.scratchNames = undefined;
      this.otherUses = undefined;
      this.blocked = new Map();
    }
    return result;
  }

  /**
   * How much of a component's declaration inlining every call removes: all
   * of it when nothing else uses it, the module's share when other modules
   * use it too, and none when a call cannot be inlined or anything else
   * keeps it.
   */
  private removedShare(
    component: Component,
    copies: ReadonlyMap<JSXElement, PreparedSite | undefined>,
    otherUses: ReadonlyMap<Component, number>,
  ): number {
    if (
      component.declaration === undefined ||
      otherUses.get(component) !== 0 ||
      hasMissingCopy(copies.values())
    ) {
      return 0;
    }
    const users = this.context.options.sharedComponents.get(component.binding.name) ?? 1;
    return users > 0 ? 1 / users : 0;
  }

  /**
   * What inlining `component` saves through the calls in its children that
   * can only be inlined once it is: a component with statements needs an
   * element around its call to hoist them to.
   */
  private enabledGain(
    component: Component,
    copies: readonly PreparedSite[],
    copiesOf: ReadonlyMap<Component, ReadonlyMap<JSXElement, PreparedSite | undefined>>,
    otherUses: ReadonlyMap<Component, number>,
  ): number {
    const elements: JSXElement[] = [];
    for (const copy of copies) {
      elements.push(copy.element);
    }
    this.assumedHosts = new Set(elements);
    let gain = 0;
    try {
      for (const [other, byElement] of copiesOf) {
        if (other === component) {
          continue;
        }
        const enabled = new Map(byElement);
        let changed = false;
        for (const [element, copy] of byElement) {
          if (!copy && isWithinAny(element, elements)) {
            const next = this.prepare(other, element);
            enabled.set(element, next);
            changed ||= next !== undefined;
          }
        }
        if (!changed) {
          continue;
        }
        const now = collectPrepared(byElement.values());
        const then = collectPrepared(enabled.values());
        const before = now.length > 0 ? Math.max(0, this.inliningGain(other, now, 0)) : 0;
        const after = this.inliningGain(other, then, this.removedShare(other, enabled, otherUses));
        gain += Math.max(0, after - before);
      }
    } finally {
      this.assumedHosts = undefined;
    }
    return gain;
  }

  /**
   * How much smaller the copies are than the calls they replace, once
   * lowered, counting the `share` of the declaration they remove.
   * Negative when they are larger.
   */
  private inliningGain(
    component: Component,
    copies: readonly PreparedSite[],
    share: number,
  ): number {
    const estimator = this.estimator();
    let calls =
      share > 0 && component.declaration ? share * estimator.node(component.declaration) : 0;
    let inlined = 0;
    const blocked = this.blockedWithin(component);
    // The blocked components that some copy still calls once measured.
    const kept = new Set<Component>();
    for (const copy of copies) {
      const inTemplate = this.sitsInTemplate(copy.element);
      calls += estimator.jsx(copy.element, inTemplate);
      const measured = { code: '' };
      inlined += copySize(
        this.context.filename,
        this.sizeHeader(),
        copy,
        inTemplate,
        this.context.options,
        blocked.length > 0 ? { declarations: this.createDeclarations(blocked), inline } : undefined,
        measured,
      );
      const body = measured.code.slice(measured.code.lastIndexOf(COPY_WRAPPER));
      for (const inner of blocked) {
        if (hasTag(body, inner.binding.name)) {
          kept.add(inner);
        }
      }
    }
    // A blocked component that inlines into every copy goes away with this
    // one, when nothing else uses it.
    if (share > 0) {
      for (const inner of blocked) {
        if (!kept.has(inner) && inner.declaration && this.onlyUsedWithin(inner, component)) {
          calls += share * estimator.node(inner.declaration);
        }
      }
    }
    return calls - inlined;
  }

  /**
   * The components whose calls in a component's body cannot be inlined
   * there, but may be in a copy, once the call site resolves the props
   * they are given. Those they call in turn count too.
   */
  private blockedWithin(component: Component): Component[] {
    const found: Component[] = [];
    const pending = [component];
    for (let outer = pending.pop(); outer; outer = pending.pop()) {
      for (const inner of this.blocked.get(outer) ?? []) {
        if (inner !== component && !found.includes(inner)) {
          found.push(inner);
          pending.push(inner);
        }
      }
    }
    return found;
  }

  /** The declarations of components, for a copy measured on its own. */
  private createDeclarations(components: readonly Component[]): string {
    const texts: string[] = [];
    for (const component of components) {
      const statement = this.topLevelStatement(component.binding.declaration);
      if (statement) {
        texts.push(getText(this.context, statement).code);
      }
    }
    return texts.join('\n');
  }

  /** Whether every call of `inner` is in `outer`, and nothing else uses it. */
  private onlyUsedWithin(inner: Component, outer: Component): boolean {
    if (this.otherUses?.get(inner) !== 0) {
      return false;
    }
    for (const site of this.sites) {
      if (site.component === inner && !isWithin(site.element, outer.fn)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Whether an element sits directly in an intrinsic element, whose
   * template its copy joins. A provider this pass makes transparent is
   * removed once its consumers are inlined, so the element above it counts.
   */
  private sitsInTemplate(element: JSXElement): boolean {
    let parent = this.context.parents.get(element);
    while (parent?.type === 'JSXElement' && this.transparent.has(parent)) {
      parent = this.context.parents.get(parent);
    }
    if (parent?.type === 'JSXElement' && this.assumedHosts?.has(parent) === true) {
      return true;
    }
    return (
      parent?.type === 'JSXElement' &&
      parent.openingElement.name.type === 'JSXIdentifier' &&
      isIntrinsicTag(parent.openingElement.name.name)
    );
  }

  private sizeEstimator: SizeEstimator | undefined;

  private estimator(): SizeEstimator {
    this.sizeEstimator ??= new SizeEstimator(this.context.code);
    return this.sizeEstimator;
  }

  private header: string | undefined;

  /** The components of the module this pass can inline. */
  private readonly components: Component[] = [];

  /** The call sites of those components. */
  private sites: readonly CallSite[] = [];

  /** How many times each component is used other than as a call, while estimating. */
  private otherUses: ReadonlyMap<Component, number> | undefined;

  /**
   * The components called in each component's body where the call cannot
   * be inlined as it is, while estimating.
   */
  private blocked = new Map<Component, Component[]>();

  /** The top-level statement a node is part of, without an `export`. */
  private topLevelStatement(node: Node): Node | undefined {
    let current = node;
    for (let parent = this.context.parents.get(current); parent;) {
      if (parent.type === 'Program') {
        return current.type === 'ExportNamedDeclaration' ||
          current.type === 'ExportDefaultDeclaration'
          ? (current.declaration ?? undefined)
          : current;
      }
      current = parent;
      parent = this.context.parents.get(current);
    }
    return undefined;
  }

  /**
   * What a copy measured on its own needs to know: the module's imports,
   * and the names that alias Solid's exports.
   */
  private sizeHeader(): string {
    if (this.header === undefined) {
      // The imports, and the top-level constants made of literals, so a copy
      // folds with the values its call site passes by name, as it will once inlined.
      const imports: string[] = [];
      for (const statement of this.context.program.body) {
        if (statement.type === 'ImportDeclaration' || isDataDeclaration(statement)) {
          imports.push(this.context.code.slice(statement.start, statement.end));
        }
      }
      const aliases = [...this.context.options.builtInAliases.keys()];
      if (aliases.length > 0) {
        imports.push(`var ${aliases.join(', ')};`);
      }
      this.header = imports.join('\n');
    }
    return this.header;
  }

  /**
   * The component a top-level alias like `const Button = ButtonRoot` names,
   * or `undefined` when the binding is not one.
   */
  private aliasTarget(binding: Binding): Binding | undefined {
    const { declaration } = binding;
    if (
      !isCapitalized(binding.name) ||
      !isConstantDeclaration(binding, this.context.options) ||
      declaration.type !== 'VariableDeclarator' ||
      declaration.id !== binding.identifier ||
      !declaration.init
    ) {
      return undefined;
    }
    const init = unwrap(declaration.init);
    if (init.type !== 'Identifier') {
      return undefined;
    }
    const target = this.context.scopes.references.get(init);
    return target &&
      target !== binding &&
      target.scope.parent === undefined &&
      !target.mutated &&
      isCapitalized(target.name)
      ? target
      : undefined;
  }

  /**
   * The parts of a compound component like Kobalte's
   * `const Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger })`,
   * or `undefined` when the binding is not one. `<Dialog>` is `<DialogRoot>`,
   * since `Object.assign` returns its first argument, and `<Dialog.Trigger>`
   * is `<DialogTrigger>` while nothing writes to a member of either.
   */
  private compoundTarget(
    binding: Binding,
  ): { root: Binding; parts: ReadonlyMap<string, Binding> } | undefined {
    const { declaration } = binding;
    if (
      !isCapitalized(binding.name) ||
      !isConstantDeclaration(binding, this.context.options) ||
      declaration.type !== 'VariableDeclarator' ||
      declaration.id !== binding.identifier ||
      !declaration.init
    ) {
      return undefined;
    }
    const init = unwrap(declaration.init);
    if (
      init.type !== 'CallExpression' ||
      init.optional ||
      init.arguments.length !== 2 ||
      !this.isObjectAssign(init.callee)
    ) {
      return undefined;
    }
    const [first, second] = init.arguments;
    if (first.type !== 'Identifier' || second.type !== 'ObjectExpression') {
      return undefined;
    }
    const root = this.topLevelComponent(first);
    if (!root || root === binding || this.hasMemberWrite(binding) || this.hasMemberWrite(root)) {
      return undefined;
    }
    const parts = new Map<string, Binding>();
    for (const property of second.properties) {
      if (
        property.type !== 'Property' ||
        property.kind !== 'init' ||
        property.computed ||
        property.method ||
        property.value.type !== 'Identifier'
      ) {
        return undefined;
      }
      const key = propertyKeyName(property.key);
      if (key === undefined) {
        return undefined;
      }
      // Only parts with a capitalized name can be tags. The others stay reads.
      const part = this.topLevelComponent(property.value);
      if (part) {
        parts.set(key, part);
      }
    }
    return { root, parts };
  }

  /** Whether `callee` is the global `Object.assign`. */
  private isObjectAssign(callee: Node): boolean {
    return (
      callee.type === 'MemberExpression' &&
      !callee.computed &&
      !callee.optional &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'Object' &&
      !this.context.scopes.references.get(callee.object) &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'assign'
    );
  }

  /** The top-level binding with a capitalized name that `reference` reads, when nothing reassigns it. */
  private topLevelComponent(reference: Node): Binding | undefined {
    const target = this.context.scopes.references.get(reference);
    return target &&
      target.scope.parent === undefined &&
      !target.mutated &&
      isCapitalized(target.name)
      ? target
      : undefined;
  }

  /** Whether anything assigns to, updates, or deletes a member of the binding. */
  private hasMemberWrite(binding: Binding): boolean {
    for (const reference of binding.references) {
      const member = this.context.parents.get(reference);
      if (member?.type !== 'MemberExpression' || member.object !== reference) {
        continue;
      }
      const use = this.context.parents.get(member);
      if (
        (use?.type === 'AssignmentExpression' && use.left === member) ||
        use?.type === 'UpdateExpression' ||
        (use?.type === 'UnaryExpression' && use.operator === 'delete')
      ) {
        return true;
      }
    }
    return false;
  }

  /** Whether the code reads a member of the binding, like `DialogRoot.Trigger`. */
  private hasMemberRead(binding: Binding): boolean {
    for (const reference of binding.references) {
      const member = this.context.parents.get(reference);
      if (
        (member?.type === 'MemberExpression' || member?.type === 'JSXMemberExpression') &&
        member.object === reference
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * The statement of an alias nothing uses that `reference` is the value
   * of, like `const Separator = SeparatorRoot` once its tags are renamed.
   * It does not keep the component, and goes away with it. A compound
   * component counts too, when its tags are renamed and nothing reads the
   * members `Object.assign` gave its root.
   */
  private unusedAlias(reference: Node): Node | undefined {
    let declarator = this.context.parents.get(reference);
    if (declarator?.type === 'Property') {
      declarator = this.context.parents.get(declarator);
    }
    if (declarator?.type === 'ObjectExpression' || declarator?.type === 'CallExpression') {
      const call =
        declarator.type === 'CallExpression' ? declarator : this.context.parents.get(declarator);
      declarator = call ? this.context.parents.get(call) : undefined;
    }
    if (declarator?.type !== 'VariableDeclarator' || declarator.id.type !== 'Identifier') {
      return undefined;
    }
    const alias = this.context.scopes.root.bindings.get(declarator.id.name);
    if (alias?.declaration !== declarator || alias.references.length > 0) {
      return undefined;
    }
    const compound = this.compoundTarget(alias);
    if (this.aliasTarget(alias) === undefined && (!compound || this.hasMemberRead(compound.root))) {
      return undefined;
    }
    const statement = this.context.parents.get(declarator);
    return statement?.type === 'VariableDeclaration' &&
      statement.declarations.length === 1 &&
      this.context.parents.get(statement)?.type === 'Program'
      ? statement
      : undefined;
  }

  /**
   * Renames each tag of an alias to the component it names, where that name
   * means the same. Libraries often export a component under a second name,
   * like `const Separator = SeparatorRoot`. The next pass inlines the calls.
   */
  private renameAliasTags(): boolean {
    let renamed = false;
    for (const binding of this.context.scopes.root.bindings.values()) {
      const compound = this.compoundTarget(binding);
      const target = this.aliasTarget(binding) ?? compound?.root;
      if (!target) {
        continue;
      }
      for (const reference of binding.references) {
        const parent = this.context.parents.get(reference);
        // `<Dialog.Trigger>` is the part `Object.assign` gave the root.
        let tag: Node = reference;
        let renamedTo = target;
        if (parent?.type === 'JSXMemberExpression' && parent.object === reference) {
          const part = compound?.parts.get(parent.property.name);
          if (!part) {
            continue;
          }
          tag = parent;
          renamedTo = part;
        }
        const element = this.context.parents.get(tag);
        if (
          (element?.type !== 'JSXOpeningElement' && element?.type !== 'JSXClosingElement') ||
          element.name !== tag
        ) {
          continue;
        }
        const scope = scopeAt(this.context.scopes, this.context.parents, reference);
        if (lookup(scope, renamedTo.name) !== renamedTo) {
          continue;
        }
        this.context.s.overwrite(tag.start, tag.end, renamedTo.name);
        renamed = true;
      }
    }
    return renamed;
  }

  run(): void {
    // The calls through an alias inline in the next pass, from the renamed tags.
    if (this.renameAliasTags()) {
      this.changed = true;
      return;
    }
    const { components } = this;
    const rejected = new Map<Binding, string>();
    for (const binding of this.context.scopes.root.bindings.values()) {
      this.reason = 'not-a-function';
      const component = this.analyzeComponent(binding);
      if (component) {
        components.push(component);
      } else {
        rejected.set(binding, this.reason);
      }
    }
    // Why each call site that stays a call was not inlined, for the report.
    const siteReasons = new Map<JSXElement, string>();
    if (components.length === 0) {
      this.report(rejected, siteReasons);
      return;
    }

    const sites: CallSite[] = [];
    const otherUses = new Map<Component, number>();
    // The aliases nothing uses, which are removed with their component.
    const aliases = new Map<Component, Node[]>();
    for (const component of components) {
      let uses = 0;
      for (const reference of component.binding.references) {
        const parent = this.context.parents.get(reference);
        if (parent?.type === 'JSXClosingElement') {
          continue;
        }
        const element = parent ? this.context.parents.get(parent) : undefined;
        const alias = this.unusedAlias(reference);
        if (parent?.type === 'JSXOpeningElement' && element?.type === 'JSXElement') {
          sites.push({ component, element });
        } else if (alias) {
          aliases.set(component, [...(aliases.get(component) ?? []), alias]);
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
    const worthwhile = this.worthwhileComponents(sites, changedBodies, otherUses);
    for (const site of inBodyOrder(sites)) {
      const postponed = changedBodies.has(site.component);
      // Each copy is made now, so it takes in the call sites inside it that
      // were inlined before it.
      const copy =
        postponed || !worthwhile.has(site.component)
          ? undefined
          : this.prepare(site.component, site.element);
      const done = copy !== undefined;
      if (copy) {
        this.commit(copy);
        this.changed = true;
        const elements = inlined.get(site.component) ?? [];
        elements.push(site.element);
        inlined.set(site.component, elements);
      } else {
        otherUses.set(site.component, (otherUses.get(site.component) ?? 0) + 1);
        if (this.context.skips && !postponed) {
          siteReasons.set(site.element, this.siteReason(site, worthwhile));
        }
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
    this.report(rejected, siteReasons);

    // A component nothing uses anymore is removed. A copy made in this pass
    // comes from the original code, so a component used inside a copied
    // component stays until the next pass inlines it there too.
    const copied = [...inlined.keys()];
    for (const [component, elements] of inlined) {
      const insideCopy = isInsideOtherCopy(component, elements, copied);
      if (component.declaration && otherUses.get(component) === 0 && !insideCopy) {
        this.context.s.remove(component.declaration.start, component.declaration.end);
        for (const alias of aliases.get(component) ?? []) {
          this.context.s.remove(alias.start, alias.end);
        }
      }
    }
  }

  /**
   * Why a call site of a component was not inlined. A component that is
   * not worth inlining is only turned down for its size when the call site
   * could be inlined.
   */
  private siteReason(site: CallSite, worthwhile: ReadonlySet<Component>): string {
    if (worthwhile.has(site.component)) {
      return this.reason;
    }
    this.scratchNames = new Set(this.context.scopes.names);
    try {
      return this.prepare(site.component, site.element) ? 'size' : this.reason;
    } finally {
      this.scratchNames = undefined;
    }
  }

  /**
   * Records each component call that stays a call, and why. Solid's
   * built-ins and context providers are left out. The provider pass
   * reports providers.
   */
  private report(
    rejected: ReadonlyMap<Binding, string>,
    siteReasons: ReadonlyMap<JSXElement, string>,
  ): void {
    if (!this.context.skips) {
      return;
    }
    const visit = (node: Node): void => {
      if (node.type === 'JSXElement') {
        const reason = this.callReason(node, rejected, siteReasons);
        if (reason) {
          recordSkip(this.context, 'inline', reason.reason, reason.name);
        }
      }
      forEachChild(node, visit);
    };
    visit(this.context.program);
  }

  private callReason(
    element: JSXElement,
    rejected: ReadonlyMap<Binding, string>,
    siteReasons: ReadonlyMap<JSXElement, string>,
  ): { reason: string; name: string } | undefined {
    const tag = element.openingElement.name;
    if (tag.type === 'JSXMemberExpression') {
      return { reason: 'member-tag', name: getText(this.context, tag).code };
    }
    if (tag.type !== 'JSXIdentifier' || !isCapitalized(tag.name)) {
      return undefined;
    }
    const { name } = tag;
    const binding = this.context.scopes.references.get(tag);
    const identity = binding ? solidExport(binding, this.context.options) : name;
    if (
      (identity !== undefined && this.context.options.builtIns.has(identity)) ||
      contextBinding(this.context, tag)
    ) {
      return undefined;
    }
    if (!binding) {
      return { reason: 'global', name };
    }
    if (binding.kind === 'import') {
      // A chunk imports other chunks through placeholders the bundler fills in later.
      const source = (binding.source ?? '').replaceAll(/!~\{\w+\}~/g, '*');
      return { reason: 'imported', name: `${name} (${source})` };
    }
    if (binding.scope.parent !== undefined) {
      return { reason: 'nested', name };
    }
    const reason = rejected.get(binding) ?? siteReasons.get(element);
    return reason === undefined ? undefined : { reason, name };
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
        const written: Content[] = [];
        for (const text of texts) {
          written.push(text, `\n${indent}`);
        }
        this.context.s.prependRight(host.statement.start, join(written));
      } else {
        this.context.s.prependRight(host.body.start, joinText`{ ${join(texts, ' ')} return `);
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

/** Whether another pending site must be done before this one. */
function hasPendingDependency(pending: readonly CallSite[], site: CallSite): boolean {
  for (const other of pending) {
    if (
      other !== site &&
      (isWithin(other.element, site.component.fn) || isWithin(other.element, site.element))
    ) {
      return true;
    }
  }
  return false;
}

function areDataDeclarators(declarators: readonly VariableDeclarator[]): boolean {
  for (const declarator of declarators) {
    if (
      declarator.id.type !== 'Identifier' ||
      declarator.init === null ||
      !isDataLiteral(declarator.init)
    ) {
      return false;
    }
  }
  return true;
}

function areDataElements(elements: readonly (ArrayExpressionElement | null)[]): boolean {
  for (const element of elements) {
    if (element === null || element.type === 'SpreadElement' || !isDataLiteral(element)) {
      return false;
    }
  }
  return true;
}

function areDataProperties(properties: readonly ObjectPropertyKind[]): boolean {
  for (const property of properties) {
    if (
      property.type !== 'Property' ||
      property.kind !== 'init' ||
      property.method ||
      property.computed ||
      !isDataLiteral(property.value)
    ) {
      return false;
    }
  }
  return true;
}

function getSignificantChildren(children: readonly JSXChild[]): JSXChild[] {
  const significant: JSXChild[] = [];
  for (const child of children) {
    if (!isInsignificant(child)) {
      significant.push(child);
    }
  }
  return significant;
}

function hasSpreadChild(children: readonly JSXChild[]): boolean {
  for (const child of children) {
    if (child.type === 'JSXSpreadChild') {
      return true;
    }
  }
  return false;
}

function hasSiteInside(sites: readonly CallSite[], element: JSXElement): boolean {
  for (const site of sites) {
    if (isWithin(site.element, element) && site.element !== element) {
      return true;
    }
  }
  return false;
}

function findOuterComponent(
  components: readonly Component[],
  inner: Component,
  element: JSXElement,
): Component | undefined {
  for (const item of components) {
    if (item !== inner && isWithin(element, item.fn)) {
      return item;
    }
  }
  return undefined;
}

function collectPrepared(copies: Iterable<PreparedSite | undefined>): PreparedSite[] {
  const prepared: PreparedSite[] = [];
  for (const copy of copies) {
    if (copy !== undefined) {
      prepared.push(copy);
    }
  }
  return prepared;
}

function hasMissingCopy(copies: Iterable<PreparedSite | undefined>): boolean {
  for (const copy of copies) {
    if (copy === undefined) {
      return true;
    }
  }
  return false;
}

function isWithinAny(element: JSXElement, outers: readonly JSXElement[]): boolean {
  for (const outer of outers) {
    if (isWithin(element, outer)) {
      return true;
    }
  }
  return false;
}

function isInsideOtherCopy(
  component: Component,
  elements: readonly JSXElement[],
  copied: readonly Component[],
): boolean {
  for (const element of elements) {
    for (const other of copied) {
      if (other !== component && element.start >= other.fn.start && element.end <= other.fn.end) {
        return true;
      }
    }
  }
  return false;
}

function hasChild(children: readonly Node[], child: Node): boolean {
  for (const item of children) {
    if (item === child) {
      return true;
    }
  }
  return false;
}

/** The name a non-computed object key spells, like `Trigger` or `'Trigger'`. */
function propertyKeyName(key: Node): string | undefined {
  if (key.type === 'Identifier') {
    return key.name;
  }
  return key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined;
}
