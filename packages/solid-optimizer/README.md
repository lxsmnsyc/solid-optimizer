# solid-optimizer

> Experimental compile-time optimizer for SolidJS 1.x

[![NPM](https://img.shields.io/npm/v/solid-optimizer.svg)](https://www.npmjs.com/package/solid-optimizer)

`solid-optimizer` rewrites JSX before Solid's JSX transform lowers it. It inlines components and resolves control flow whose outcome is known at build time, so more markup lands in fewer templates.

## Install

```bash
npm i -D solid-optimizer
```

```bash
yarn add -D solid-optimizer
```

```bash
pnpm add -D solid-optimizer
```

## Usage

```js
import { compile } from 'solid-optimizer';

const result = compile(code, { filename: 'app.jsx' });

result.code; // JSX, ready for Solid's JSX transform
result.map; // a source map, or `null` when nothing changed
```

The input and the output both keep their JSX. Run the JSX transform after `compile`.

`compile` works on a single module or on a bundled chunk that kept its JSX. A chunk holds more components in one scope, so more of them inline.

### Options

- `filename` sets the parser and the source map source. `.ts` and `.tsx` parse as TypeScript. Anything else parses as JSX. Defaults to `input.jsx`.
- `fold` turns constant folding and control-flow resolution on or off. Defaults to `true`.
- `inline` turns component inlining on or off. Defaults to `true`.
- `alwaysInline` inlines every component that can be, even where the copies are larger than the calls they replace. Defaults to `false`. See [Only where it is smaller](#only-where-it-is-smaller).
- `sharedComponents` maps top-level components that other modules use too to the number of modules that use them, this one included. Inlining one only counts its share of the declaration. `0` keeps the declaration whatever is inlined.
- `contexts` turns context provider removal on or off. Defaults to `true`.
- `memos` turns memo inlining on or off. Defaults to `true`.
- `server` compiles for the server. It removes `createEffect` and `onMount`, and reduces `untrack`, `batch`, `startTransition`, `createDeferred`, `getListener`, `createMemo`, `createRenderEffect`, and `createComputed` to what they do on the server. Defaults to `false`.
- `builtIns` lists the names of Solid's built-in components. A tag only folds when it is one of them. An empty list turns control-flow folding off.
- `moduleSources` lists the modules Solid's built-ins are imported from. Defaults to `['solid-js', 'solid-js/web']`.
- `importedConstants` holds the constants of imported modules, keyed by the import specifier as the code writes it, then by export name. An import of one of them folds like a local `const`. See [Constants from other modules](#constants-from-other-modules).
- `maxPasses` limits how many rounds run. Compilation stops early once a round changes nothing. Defaults to `10`.
- `sourceMap` turns the source map on or off. Defaults to `true`.

### Constants from other modules

`readModuleConstants` reads the constants a module exports, and the modules it imports from.

```js
import { compile, readModuleConstants } from 'solid-optimizer';

const config = readModuleConstants(configCode, { filename: 'config.ts' });
config.exports; // { SHOW_BANNER: true, THEME: 'light' }

compile(appCode, {
  filename: 'app.tsx',
  importedConstants: { './config': config.exports },
});
```

It keeps `export const` bindings whose value folds, a `let` the module never writes to, `export default` of a constant, and names exported from them. `import * as config` also works, as `config.NAME`. A module that re-exports constants from another module takes that module's constants in its own `importedConstants`.

> **Warning**
> The output changes the shape of the rendered tree, and with it the hydration keys. Compile a server build and its client build from the same code with the same options.

## Vite

`solid-optimizer/vite` replaces `vite-plugin-solid`. It takes the same options and wraps the official plugin, so SSR and HMR keep working.

```js
// vite.config.js
import { defineConfig } from 'vite';
import solid from 'solid-optimizer/vite';

export default defineConfig({
  plugins: [solid({ ssr: true })],
});
```

`vite-plugin-solid` and `vite` are peer dependencies.

The plugin optimizes in one of two modes.

- **Chunk mode** is for client builds that do not hydrate. Constants fold and memos inline in each module first, so a branch that folds away takes its imports and `lazy()` chunks out of the bundle. Components imported from other modules are inlined there too, so the bundler drops them and the runtime code only they used. JSX is then kept through bundling. Each chunk is optimized as a whole and then lowered by Solid's JSX transform, so a component inlines anywhere in its chunk.
- **Module mode** is for everything else. Each module is optimized before the official plugin lowers it, with the components it imports from other modules copied in first. A server build and its client build split chunks differently, and hydration needs both to render the same tree, so every decision depends only on the modules. Two modules that import each other do not copy each other's components.

Both modes fold constants imported from other modules in the project.

- Each import is resolved and loaded by the bundler, so aliases, virtual modules, and plugins that rewrite the module are respected.
- A module with JSX is not loaded, since its transform could be waiting for the importer. Its constants still fold in chunk mode.
- `define` and `import.meta.env` values only fold in chunk mode.
- Dependencies are not read, and nothing is read while serving.

The optimizer is off while serving. Set `optimizer.dev` to run module mode in dev too.

### Options

The plugin takes every option of `vite-plugin-solid`, plus `optimizer`.

- `optimizer: false` uses `vite-plugin-solid` as it is.
- `optimizer.fold`, `optimizer.inline`, `optimizer.alwaysInline`, `optimizer.contexts`, `optimizer.memos`, and `optimizer.maxPasses` work like the `compile` options.
- `optimizer.mode` is `'auto'` by default. Set it to `'module'` to never keep JSX through bundling.
- `optimizer.dev` also optimizes while serving. Defaults to `false`.
- `optimizer.server` applies the `server` option in server builds. Defaults to `true`.

### Limits

- Chunk mode is skipped when the `babel` option is set, since those Babel plugins need each module.
- An export named `__so_local$name` is added to a module for each local binding its exported components need, so a copy in another module can import it. In chunk mode, entry modules get none.
- A component used in several chunks is copied into each of them, where each copy is no larger than its call.
- Components from dependencies in `node_modules` are not copied.
- Modules matched by the `extensions` option are lowered by the official plugin and are not optimized.

## Features

### Component inlining

A component call is replaced with the component's JSX.

```jsx
function Title(props) {
  return <h1 class="title">{props.label}</h1>;
}

export function App() {
  return (
    <main>
      <Title label="Hello" />
    </main>
  );
}
```

becomes

```jsx
export function App() {
  return (
    <main>
      <h1 class="title">{'Hello'}</h1>
    </main>
  );
}
```

Solid then creates one template for `<main>` instead of two.

- A read of `props.name` becomes the attribute's expression. Solid passes dynamic props as getters, so the expression runs at every read, as before.
- A static prop that must be evaluated once, like a function read twice, is stored in a `const` first.
- `{props.children}`, and a prop whose value is JSX, splice their JSX in place so it joins the template.
- Statements in the component body move into the component whose returned JSX holds the call. The call must sit directly in that JSX, with only intrinsic elements and fragments around it.
- Bindings declared in the component get fresh names in every copy.
- A component nothing else uses is removed.

A component inlines when all of these hold:

- It is declared once at the top level, with a capitalized name.
- Its parameter is one identifier that is only read as `props.name`, or passed to `mergeProps()` and `splitProps()`. See below.
- Its body ends in the only `return`, and that `return` returns JSX.
- It does not use `this`, `arguments`, `super`, or `new.target`.
- The call site has no spread attribute, no `ref`, and no namespaced attribute.

The props can go through `mergeProps()` and `splitProps()` first, declared as a `const` in the component:

```jsx
function Button(props) {
  const merged = mergeProps({ type: 'button' }, props);
  const [local, rest] = splitProps(merged, ['label']);
  return (
    <button type={merged.type} {...rest}>
      {local.label}
    </button>
  );
}
```

- A default has to be a literal, like `'button'`, `0`, or `false`.
- `splitProps()` has to name its keys in array literals.
- A view can only be read as `view.name`, spread onto an element, or passed to another `mergeProps()` or `splitProps()`.
- A prop that can be `undefined` falls back to the default behind it, the way `mergeProps()` reads it.
- A spread becomes the attributes the call site passes, and it cannot repeat an attribute the element already has. Its `children` become the element's children, so the element must have none of its own.

Inlining accepts two differences:

- A prop called as `props.name()` runs with its own receiver as `this`, not the props object.
- Moved statements run before the host's JSX is created. The order of effect registration between siblings can change.

Inlined JSX is a copy, so its source map points at the call site it replaced.

#### Only where it is smaller

Every copy repeats the component's own code, so inlining a component at many calls can make the output larger than the calls were. Before inlining, each component's copies are compared with what they replace, as Solid's JSX transform would lower them:

- A copy saves the component call, and the getters of its props. Elements it puts directly in another element join that element's template.
- A copy costs the component's statements, its dynamic attributes and children, and the elements that cannot join a template. Constant props are folded first, so a branch they rule out costs nothing.
- When every call inlines and nothing else uses the component, its declaration goes away too.
- A call in its children that can only inline once it does, because that component has statements to hoist, counts too.

A component inlines only when its copies are no larger. A small component, or one used once, inlines at every call. A wrapper used many times, whose root is another component, like most wrappers of a component library, stays a component.

In the Vite plugin, a component copied from another module counts the module's share of its declaration: all of it when the importer is its only user, and one part in n when n modules use it, since it goes away once every one of them copies it. The plugin reads which modules use each export from the files the entries reach, and from the module scripts of an HTML entry. A re-export, a dynamic import, a use as a value, or a user the component's module imports back keeps the declaration whole.

Set `alwaysInline` to inline every component that can be.

### Context inlining

A context provider, `<Ctx.Provider>`, whose readers are all visible is removed, and each read gets the provider's value.

```jsx
const Theme = createContext();

function Label() {
  const theme = useContext(Theme);
  return <span class={theme}>label</span>;
}

export function App() {
  return (
    <main>
      <Theme.Provider value="dark">
        <Label />
      </Theme.Provider>
    </main>
  );
}
```

becomes

```jsx
export function App() {
  const theme$1 = 'dark';
  return (
    <main>
      <span class={'dark'}>label</span>
    </main>
  );
}
```

- Everything under the provider has to be visible: intrinsic elements, Solid's built-ins, and components that inline. A call to an unknown function, or a read of a component's `props`, keeps the provider.
- An object value is stored in a `const` once, so every reader gets the same object.
- The value must never be `undefined`.
- Removing the provider removes its owner, so the hydration keys change. Compile a server build and its client build with the same options.

See [strategy.md](https://github.com/lxsmnsyc/solid-optimizer/blob/main/strategy.md) for the exact rules.

### Memo inlining

A `createMemo` whose result is new on every run, or that sets `equals: false` in its options,, such as an object, array, or JSX, never stops an update. When it is also read once, as the whole of a tracked JSX expression, the read runs the computation itself.

```jsx
const style = createMemo(() => ({ color: color() }));
return <p style={style()} />;
```

becomes `<p style={{ color: color() }} />`. The computation must take no `prev` parameter, so an initial value, the second argument in Solid 1, is ignored.

### Server builds

On the server, Solid renders once and never updates, so its reactive primitives reduce to plain calls.

- `createEffect` and `onMount` are removed. Whatever only they used, like a charting library, drops out of the server bundle.
- `untrack(fn)` and `batch(fn)` become `fn()`, and `startTransition(fn)` calls `fn()` and returns nothing.
- `createDeferred(source)` becomes `source`, and `getListener()` becomes `null`.
- `createMemo`, `createRenderEffect`, and `createComputed` run their function once, in place.

This runs after the other optimizations, while modules are transformed. The server and client build then make the same inlining decisions, so hydration still matches.

Two differences are accepted. A function passed to `createMemo`, `createRenderEffect`, or `createComputed` no longer gets its own owner, so an `onCleanup` inside it registers on the enclosing one. Inside `catchError` or `<ErrorBoundary>`, an error it throws stops the component instead of leaving the memo `undefined`.

### Constant folding and control flow

This follows the `optimize` option of Solid 2.0's `@solidjs/compiler` ([solidjs/solid#3231](https://github.com/solidjs/solid/pull/3231)), applied to Solid 1's components.

- Constant expressions fold, including `const` bindings and `let` bindings nothing writes to, at any scope.
- Branches that a constant condition never takes are removed. So are statements after a `return`, `throw`, `break`, or `continue`.
- `<Show when>` becomes its children or its `fallback`.
- `<For each>` becomes its `fallback` when `each` is an empty array literal or a falsy constant.
- `<Index each>` becomes its `fallback` under the same conditions as `<For each>`.
- `<Switch>` drops each `<Match>` that is always false, and becomes the first `<Match>` that is always true.
- `<Dynamic component="div">` becomes `<div>`.

A built-in only folds when the tag resolves to Solid's component. The tag must bind to nothing, or be imported from one of `moduleSources`. A tag with a spread attribute or a function child never folds. `<Portal>`, `<Suspense>`, `<SuspenseList>`, and `<ErrorBoundary>` never fold.

A call to Solid's `lazy` is marked `/* @__PURE__ */`, so the bundler drops one that a folded branch left unused, along with its chunk.

A condition that is discarded but has side effects still runs. `[effect()] && value` becomes `([effect()], value)`.

## Sponsors

![Sponsors](https://github.com/lxsmnsyc/sponsors/blob/main/sponsors.svg?raw=true)

## License

MIT © [lxsmnsyc](https://github.com/lxsmnsyc)
