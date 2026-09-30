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
- `memos` turns memo inlining on or off. Defaults to `true`.
- `builtIns` lists the names of Solid's built-in components. A tag only folds when it is one of them. An empty list turns control-flow folding off.
- `moduleSources` lists the modules Solid's built-ins are imported from. Defaults to `['solid-js', 'solid-js/web']`.
- `maxPasses` limits how many rounds run. Compilation stops early once a round changes nothing. Defaults to `10`.
- `sourceMap` turns the source map on or off. Defaults to `true`.

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

- **Chunk mode** is for client builds that do not hydrate. JSX is kept through bundling. Each chunk is optimized as a whole and then lowered by Solid's JSX transform, so a component inlines anywhere in its chunk.
- **Module mode** is for everything else. Each module is optimized before the official plugin lowers it. A server build and its client build split chunks differently, and hydration needs both to render the same tree, so hydrating builds only inline within a module.

The optimizer is off while serving. Set `optimizer.dev` to run module mode in dev too.

### Options

The plugin takes every option of `vite-plugin-solid`, plus `optimizer`.

- `optimizer: false` uses `vite-plugin-solid` as it is.
- `optimizer.fold`, `optimizer.inline`, `optimizer.memos`, and `optimizer.maxPasses` work like the `compile` options.
- `optimizer.mode` is `'auto'` by default. Set it to `'module'` to never keep JSX through bundling.
- `optimizer.dev` also optimizes while serving. Defaults to `false`.

### Limits

- Chunk mode is skipped when the `babel` option is set, since those Babel plugins need each module.
- Chunk mode imports the runtime helpers a merged tree can need into every module with JSX. A chunk that shares the runtime with another chunk exports these helpers even when nothing uses them.
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
- Its parameter is one identifier that is only read as `props.name`.
- Its body ends in the only `return`, and that `return` returns JSX.
- It does not use `this`, `arguments`, `super`, or `new.target`.
- The call site has no spread attribute, no `ref`, and no namespaced attribute.

Inlining accepts two differences:

- A prop called as `props.name()` runs with its own receiver as `this`, not the props object.
- Moved statements run before the host's JSX is created. The order of effect registration between siblings can change.

Inlined JSX is a copy, so its source map points at the call site it replaced.

### Memo inlining

A `createMemo` whose result is new on every run, or that sets `equals: false` in its options,, such as an object, array, or JSX, never stops an update. When it is also read once, as the whole of a tracked JSX expression, the read runs the computation itself.

```jsx
const style = createMemo(() => ({ color: color() }));
return <p style={style()} />;
```

becomes `<p style={{ color: color() }} />`. The computation must take no `prev` parameter, so an initial value, the second argument in Solid 1, is ignored.

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

A condition that is discarded but has side effects still runs. `[effect()] && value` becomes `([effect()], value)`.

## Sponsors

![Sponsors](https://github.com/lxsmnsyc/sponsors/blob/main/sponsors.svg?raw=true)

## License

MIT © [lxsmnsyc](https://github.com/lxsmnsyc)
