/**
 * The server pass: rewrites Solid's reactive primitives to what they do on the server.
 *
 * It runs once, after the other passes. Running it first would change what
 * the inliner and fold pass see on the server but not on the client, and the
 * two builds would render different trees. A component whose only statement
 * is `onMount(...)` would inline on the server and stay a component on the
 * client, which breaks hydration. It still runs while modules are
 * transformed, so the bundler drops whatever only the removed calls used.
 *
 * On the server, Solid renders once and never updates, so most primitives
 * reduce to a plain call (`solid-js/dist/server.js` in Solid 1.9):
 *
 * - `createEffect(fn)` and `onMount(fn)` do nothing, so they are removed.
 *   Anything only they used, like a charting library, can then be dropped
 *   from the server bundle.
 * - `untrack(fn)` and `batch(fn)` return `fn()`.
 * - `startTransition(fn)` calls `fn()` and returns nothing.
 * - `createDeferred(source)` returns `source`.
 * - `getListener()` returns `null`.
 * - `createMemo(fn, value)` runs `fn(value)` once and returns a getter for the
 *   result. `createRenderEffect(fn, value)` and `createComputed(fn, value)`
 *   run `fn(value)` once.
 *
 * A call with a spread argument is left alone, and so is a removed call whose
 * arguments have side effects beyond creating functions.
 *
 * # Accepted differences
 *
 * `createMemo`, `createRenderEffect`, and `createComputed` run their function
 * inside a new owner, and send an error to the nearest error handler. After
 * the rewrite the function runs in the enclosing owner:
 *
 * - An `onCleanup` inside it registers on the enclosing owner.
 * - Inside a `catchError` or `<ErrorBoundary>`, an error thrown by it stops
 *   the component that holds it, instead of leaving the memo `undefined` and
 *   rendering on. Without an error handler, both throw.
 */
import type { CallExpression, Expression, Node } from 'oxc-parser';
import { forEachChild, isPrimary, unwrap } from './ast';
import type { PassContext } from './context';
import { solidExport, textOf } from './context';
import { acceptsAnyExpression } from './inline';
import { isSideEffectFree } from './value';

/** Calls the server does not run. */
const REMOVED = new Set(['createEffect', 'onMount']);

/** Calls the server runs once, in place. */
const RUN_ONCE = new Set(['createRenderEffect', 'createComputed']);

/**
 * Whether a statement starting with `text` could join the statement before
 * it when that one has no semicolon.
 */
function continuesPreviousStatement(text: string): boolean {
  return /^[([`+\-/]/.test(text);
}

class ServerSimplifier {
  changed = false;

  constructor(private readonly context: PassContext) {}

  /**
   * The Solid export a callee refers to, through a named import, an alias,
   * or a namespace import like `solid.untrack`.
   */
  private calleeName(callee: Node): string | undefined {
    const { references } = this.context.scopes;
    if (callee.type === 'Identifier') {
      const binding = references.get(callee);
      return binding ? solidExport(binding, this.context.options) : undefined;
    }
    if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') {
      return undefined;
    }
    const binding = references.get(callee.object);
    if (
      binding?.kind !== 'import' ||
      binding.imported !== '*' ||
      binding.source === undefined ||
      !this.context.options.moduleSources.includes(binding.source)
    ) {
      return undefined;
    }
    if (!callee.computed && callee.property.type === 'Identifier') {
      return callee.property.name;
    }
    if (
      callee.computed &&
      callee.property.type === 'Literal' &&
      typeof callee.property.value === 'string'
    ) {
      return callee.property.value;
    }
    return undefined;
  }

  /**
   * Whether dropping `node` loses nothing observable. Solid's `on` only
   * creates a function, so `createEffect(on(source, fn))` can go too.
   */
  private isDiscardable(node: Node): boolean {
    if (isSideEffectFree(node)) {
      return true;
    }
    const inner = node.type === 'ParenthesizedExpression' ? unwrap(node) : node;
    return (
      inner.type === 'CallExpression' &&
      this.calleeName(inner.callee) === 'on' &&
      inner.arguments.every(
        (argument) => argument.type !== 'SpreadElement' && this.isDiscardable(argument),
      )
    );
  }

  /**
   * The text of calling `fn` with `args`, the way Solid's server calls it,
   * and whether it binds as tightly as a call does.
   */
  private callText(fn: Expression, args: readonly Expression[]): { text: string; call: boolean } {
    const inner = unwrap(fn);
    const argsText = args.map((argument) => textOf(this.context, argument)).join(', ');
    if (
      inner.type === 'ArrowFunctionExpression' &&
      inner.expression &&
      inner.params.length === 0 &&
      args.length === 0 &&
      inner.body.type !== 'BlockStatement'
    ) {
      // `() => value` called with nothing is `value`.
      const { body } = inner;
      return {
        text: textOf(this.context, body),
        call: isPrimary(body) || body.type === 'CallExpression',
      };
    }
    const text = textOf(this.context, fn);
    if (inner.type === 'Identifier') {
      return { text: `${text}(${argsText})`, call: true };
    }
    if (
      inner.type === 'ArrowFunctionExpression' ||
      inner.type === 'FunctionExpression' ||
      fn.type === 'ParenthesizedExpression'
    ) {
      return { text: `(${text})(${argsText})`, call: true };
    }
    // `(0, obj.method)()` calls without `obj` as `this`, like Solid does.
    return { text: `(0, ${text})(${argsText})`, call: true };
  }

  /**
   * Whether a statement at `position` could be read as a continuation of
   * the one before it, which happens when that one has no semicolon.
   */
  private followsOpenStatement(position: number): boolean {
    const before = this.context.code.slice(0, position).trimEnd();
    return before !== '' && !before.endsWith(';') && !before.endsWith('{');
  }

  private replace(call: CallExpression, text: string | undefined, primary = false): void {
    const parent = this.context.parents.get(call);
    if (parent?.type === 'ExpressionStatement') {
      if (text === undefined) {
        // A statement in a list can go. One that is the whole body of an
        // `if` or a loop has to leave an empty statement behind.
        const list = this.context.parents.get(parent)?.type;
        const inList =
          list === 'Program' ||
          list === 'BlockStatement' ||
          list === 'StaticBlock' ||
          list === 'SwitchCase';
        if (inList) {
          this.context.s.remove(parent.start, parent.end);
        } else {
          this.context.s.overwrite(parent.start, parent.end, ';');
        }
      } else {
        let statement = text;
        // A statement cannot start with `{`, `function`, or `class`.
        if (/^(\{|function\b|async function\b|class\b)/.test(statement)) {
          statement = `(${statement})`;
        }
        const guarded =
          continuesPreviousStatement(statement) && this.followsOpenStatement(parent.start);
        this.context.s.overwrite(call.start, call.end, guarded ? `;${statement}` : statement);
      }
    } else {
      const value = text ?? 'void 0';
      // `new (f())()` is not `new f()()`.
      const isNewCallee = parent?.type === 'NewExpression' && parent.callee === call;
      const bare = !isNewCallee && (primary || acceptsAnyExpression(this.context, call));
      this.context.s.overwrite(call.start, call.end, bare ? value : `(${value})`);
    }
    this.changed = true;
  }

  private simplify(call: CallExpression): void {
    const name = this.calleeName(call.callee);
    if (name === undefined || call.arguments.some((arg) => arg.type === 'SpreadElement')) {
      return;
    }
    // Spread arguments were ruled out above.
    const args = call.arguments.filter((arg): arg is Expression => arg.type !== 'SpreadElement');
    const first = args.at(0);
    const second = args.at(1);
    const rest = args.slice(2);
    const inStatement = this.context.parents.get(call)?.type === 'ExpressionStatement';

    if (REMOVED.has(name)) {
      if (args.every((arg) => this.isDiscardable(arg))) {
        this.replace(call, undefined);
      }
      return;
    }
    switch (name) {
      case 'getListener':
        if (args.length === 0) {
          this.replace(call, 'null');
        }
        return;
      case 'untrack':
      case 'batch':
        if (first && args.length === 1) {
          const run = this.callText(first, []);
          this.replace(call, run.text, run.call);
        }
        return;
      case 'startTransition':
        if (first && args.length === 1) {
          const { text } = this.callText(first, []);
          this.replace(call, inStatement ? text : `(${text}, void 0)`, !inStatement);
        }
        return;
      case 'createDeferred':
        if (first && args.slice(1).every((arg) => this.isDiscardable(arg))) {
          const text = textOf(this.context, first);
          this.replace(call, text, isPrimary(first));
        }
        return;
      case 'createMemo':
        // `createMemo(fn, value, options)`: the options only matter for updates.
        if (first && rest.every((arg) => this.isDiscardable(arg))) {
          const { text } = this.callText(first, second ? [second] : []);
          this.replace(call, `((value) => () => value)(${text})`, true);
        }
        return;
      default:
        if (RUN_ONCE.has(name) && first && rest.length === 0) {
          const { text } = this.callText(first, second ? [second] : []);
          this.replace(call, inStatement ? text : `(${text}, void 0)`, !inStatement);
        }
    }
  }

  walk(node: Node): void {
    forEachChild(node, (child) => {
      this.walk(child);
    });
    if (node.type === 'CallExpression') {
      this.simplify(node);
    }
  }
}

/**
 * Runs the server pass over a parsed program. Returns whether anything changed.
 */
export function simplifyServer(context: PassContext): boolean {
  const simplifier = new ServerSimplifier(context);
  simplifier.walk(context.program);
  return simplifier.changed;
}
