# solid-optimizer

> Experimental compile-time optimizer for SolidJS 2.0

[![NPM](https://img.shields.io/npm/v/solid-optimizer.svg)](https://www.npmjs.com/package/solid-optimizer)

`solid-optimizer` rewrites JSX before Solid's JSX transform lowers it. It inlines components and resolves control flow whose outcome is known at build time, so more markup lands in fewer templates.

![A small app compiled by Solid's JSX transform alone and with solid-optimizer first. The optimized build has 1 template instead of 5, and its server HTML has 1 hydration key instead of 4.](https://github.com/lxsmnsyc/solid-optimizer/blob/main/examples/showcase/comparison.png?raw=true)

## Install

The Solid 2.0 version is published under the `next` tag. The `latest` version is for Solid 1.x.

```bash
npm i -D solid-optimizer@next
```

```bash
yarn add -D solid-optimizer@next
```

```bash
pnpm add -D solid-optimizer@next
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
- `contexts` turns context provider removal on or off. Defaults to `true`.
- `memos` turns memo inlining on or off. Defaults to `true`.
- `builtIns` lists the names of Solid's built-in components. A tag only folds when it is one of them. An empty list turns control-flow folding off.
- `moduleSources` lists the modules Solid's built-ins are imported from. Defaults to `['solid-js', '@solidjs/web']`.
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

`solid-optimizer/vite` replaces `@solidjs/vite-plugin`. It takes the same options and wraps the official plugin, so SSR, server functions, and HMR keep working.

```js
// vite.config.js
import { defineConfig } from 'vite';
import solid from 'solid-optimizer/vite';

export default defineConfig({
  plugins: [solid({ ssr: true })],
});
```

`@solidjs/vite-plugin` and `vite` are peer dependencies.

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

The plugin takes every option of `@solidjs/vite-plugin`, plus `optimizer`.

- `optimizer: false` uses `@solidjs/vite-plugin` as it is.
- `optimizer.fold`, `optimizer.inline`, `optimizer.contexts`, `optimizer.memos`, and `optimizer.maxPasses` work like the `compile` options.
- `optimizer.mode` is `'auto'` by default. Set it to `'module'` to never keep JSX through bundling.
- `optimizer.dev` also optimizes while serving. Defaults to `false`.

### Limits

- Chunk mode is skipped when the `babel` option is set or `compiler` is `'babel'`, since those passes need each module.
- An export named `__so_local$name` is added to a module for each local binding its exported components need, so a copy in another module can import it. In chunk mode, entry modules get none.
- A component used in several chunks is copied into each of them.
- Components from dependencies in `node_modules` are not copied.
- `.tsrx` modules are lowered by the official plugin and are not optimized.

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
- Its parameter is one identifier that is only read as `props.name`, or passed to `merge()` and `omit()`. See below.
- Its body ends in the only `return`, and that `return` returns JSX.
- It does not use `this`, `arguments`, `super`, or `new.target`.
- The call site has no spread attribute, no `ref`, and no namespaced attribute.

The props can go through `merge()` and `omit()` first, declared as a `const` in the component:

```jsx
function Button(props) {
  const merged = merge({ type: 'button' }, props);
  const rest = omit(merged, 'label');
  return (
    <button type={merged.type} {...rest}>
      {props.label}
    </button>
  );
}
```

- A default has to be a literal, like `'button'`, `0`, or `false`.
- `omit()` has to name its keys as string literals.
- A view can only be read as `view.name`, spread onto an element, or passed to another `merge()` or `omit()`.
- A spread becomes the attributes the call site passes, and it cannot repeat an attribute the element already has. Its `children` become the element's children, so the element must have none of its own.

Inlining accepts two differences:

- A prop called as `props.name()` runs with its own receiver as `this`, not the props object.
- Moved statements run before the host's JSX is created. The order of effect registration between siblings can change.

Inlined JSX is a copy, so its source map points at the call site it replaced.

### Context inlining

A context provider whose readers are all visible is removed, and each read gets the provider's value.

```jsx
const Theme = createContext();

function Label() {
  const theme = useContext(Theme);
  return <span class={theme}>label</span>;
}

export function App() {
  return (
    <main>
      <Theme value="dark">
        <Label />
      </Theme>
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

A `createMemo` whose result is new on every run, such as an object, array, or JSX, never stops an update. When it is also read once, as the whole of a tracked JSX expression, the read runs the computation itself.

```jsx
const style = createMemo(() => ({ color: color() }));
return <p style={style()} />;
```

becomes `<p style={{ color: color() }} />`. See [strategy.md](https://github.com/lxsmnsyc/solid-optimizer/blob/main/strategy.md) for the exact rules.

### Constant folding and control flow

This follows the `optimize` option of `@solidjs/compiler` ([solidjs/solid#3231](https://github.com/solidjs/solid/pull/3231)).

- Constant expressions fold, including `const` bindings and `let` bindings nothing writes to, at any scope.
- Branches that a constant condition never takes are removed. So are statements after a `return`, `throw`, `break`, or `continue`.
- `<Show when>` becomes its children or its `fallback`.
- `<For each>` becomes its `fallback` when `each` is an empty array literal or a falsy constant.
- `<Repeat count>` becomes its `fallback` when `count` is below one.
- `<Switch>` drops each `<Match>` that is always false, and becomes the first `<Match>` that is always true.
- `<Dynamic component="div">` becomes `<div>`.

A built-in only folds when the tag resolves to Solid's component. The tag must bind to nothing, or be imported from one of `moduleSources`. A tag with a spread attribute or a function child never folds. `<Portal>`, `<Loading>`, `<Errored>`, and `<Reveal>` never fold.

A call to Solid's `lazy` is marked `/* @__PURE__ */`, so the bundler drops one that a folded branch left unused, along with its chunk.

A condition that is discarded but has side effects still runs. `[effect()] && value` becomes `([effect()], value)`.

## Sponsors

![Sponsors](https://github.com/lxsmnsyc/sponsors/blob/main/sponsors.svg?raw=true)

## License

MIT © [lxsmnsyc](https://github.com/lxsmnsyc)
