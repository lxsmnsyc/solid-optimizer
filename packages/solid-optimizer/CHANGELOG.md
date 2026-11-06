# solid-optimizer

## 1.0.0-next.1

### Patch Changes

- 0948d25: Stop loading a module to read its constants when the importing module only uses its bindings as types, like `import { Config } from './config'` used in `const config: Config`. TypeScript drops such an import, so the module may be build-time only. Loading it brought its imports into the build, which failed on imports that do not resolve for the app's target and logged warnings for `node:` modules.

## 1.0.0-next.0

### Major Changes

- b7340c5: Targets Solid 2.0: `solid-js` 2 and `@solidjs/web`, with `@solidjs/vite-plugin` in the Vite plugin. Solid 1.x stays on the 0.x releases.

### Minor Changes

- 632fb35: Inline components that have statements inside the child callback of `<For>` or `<Repeat>`, the child callback of `<Show>` or `<Match>` that takes the value, and the callback given to `render`. These callbacks run untracked once per item or value, like a component, so the statements move into them.
- af97878: Replace Solid's `children` helper with its JSX when it is read once as an element's child. A component that resolves `props.children` this way now merges its children into its template once it is inlined.
- ff1bf8a: Replace a `createMemo` whose computation folds to a literal with the literal at every call. Such a memo reads no signals, so its value never changes.
- fb9033c: Remove context providers whose readers are all visible, and give each `useContext` read the provider's value. Compound components like tabs and accordions now merge into one template. Set `contexts: false` to turn it off.
- 5df5b7c: Inline components imported from other modules in server builds and builds that hydrate too. The server and client builds copy the same components, so the hydration keys still match.
- c14d550: In chunk mode, inline components imported from other modules before bundling. The bundler then drops them and the runtime code only they used, so code-split builds shrink as much as single-chunk ones.
- a79c057: Fold `define` entries and `import.meta.env` values in every build, module mode included, when all build environments share the value. `import.meta.env.SSR` never folds, so a server build and its client build fold the same values. `compile` takes them as `globalConstants`.
- 06da641: Turn `<Dynamic component={Card}>` into `<Card>` when `Card` is a component declared at the top level that nothing reassigns. The component can then inline like any other call.
- ae553db: Inline a component called with a `ref` it forwards to an element, like `<Field ref={el} />` with `<input ref={props.ref} />`. The call site's `ref` moves to that element.
- 43e63de: Fold constants imported from other modules. `compile` takes them in `importedConstants`, and `readModuleConstants` reads them from a module. `solid-optimizer/vite` loads each imported module through the bundler, so a branch they fold away is gone before bundling, along with the built-ins and `lazy()` chunks only it used.
- e59c432: Fold constants exported from a module with JSX, in module mode as well as chunk mode. A server build and its hydrating client build now fold them too, and fold the same ones.
- 6e08e9a: Inline components that read their props through `merge()` and `omit()`. Each call site resolves the defaults it does not pass, and a spread of the rest becomes the attributes it passes.
- 383f572: The Babel plugin is replaced with a `compile` function for Solid 2.0. It runs on JSX before Solid's JSX transform.
  It inlines components into the JSX that uses them, so Solid creates fewer templates.
  It also folds constants and resolves `<Show>`, `<For>`, `<Repeat>`, `<Switch>`, and `<Dynamic>` when their props are constants.
  The SSR call removals from the Babel plugin are gone.
- 3bf005e: Inline a component that spreads its props onto an element, like `<div {...props} />`. The spread becomes the attributes and children each call site passes.
- 40b96eb: Turn a call of an arrow function whose body is JSX into that JSX, when it is an element's child and its arguments are constants. A render prop called with a constant, such as `props.children(1)`, now joins the template once the component is inlined.
- a85033c: Inline a component only where its copies are no larger than the calls and declaration they replace, so the optimized output is never larger than the plain one because of inlining. The Vite plugin counts which modules use each export, so a component copied from another module only counts its declaration when the importer is its only user. `alwaysInline` restores inlining every component that can be.
- 8d171e2: Add `optimizer.report`, which lists each component call, provider, and memo the optimizer left alone, and why. `compile` takes `report` and returns the list in `skipped`.
- 016ae6a: Unroll `<For>` over a constant list, like a navigation bar's links, into one copy of its row per item when that is no larger. The rows then join the template around them.
- cc7ad74: Add `solid-optimizer/vite`, which replaces `@solidjs/vite-plugin` and takes the same options.
  Client builds that do not hydrate optimize each bundled chunk as a whole, so components inline across modules in the same chunk.
  Other builds optimize each module before Solid's JSX transform.

### Patch Changes

- 3093c0a: Fix a `ref` that names a variable, like `let el; <input ref={el} />`, in client builds that keep JSX through bundling. The bundler only saw `el` read, so it folded later reads of `el` to `undefined`.
- 147b4c4: Stop copying a component into another module when it only returns a call of a component from its own module, like an icon that wraps `<Icon>`. The copy saved nothing at the call site, and moving its markup out of its module made both compress worse.
- 4424b21: Measure a component's copy with the top-level constants its module declares, so the size estimate sees a list or condition that the copy folds once inlined. A component that renders a constant list passed by name, like `rows={ROWS}`, now inlines where that makes the output smaller.
- 31cb0a1: Build faster. The parser hands over its AST through shared memory, a pass that changes nothing no longer makes the next one parse again, and source maps are only made when the build writes them.
- 5d8ea15: Fix chunk-mode builds that failed with "JSX expressions may not use the comma operator". Rolldown and Vite print `{(a, b)}` without its parentheses, and the plugin now puts them back.
- a85033c: In chunk mode, import the members that JSX tags like `<Button.Root>` read from a namespace import by name, so the bundle does not build a namespace object for them.
- a00bfc8: Keep a context provider around a value built from props by a function the optimizer does not know, like `mergeDefaultProps()`, or around a function declared outside it. Reading them can run code that reads the context.
- 5842543: Keep optimizing a client chunk when a component inlined there turns a spread into attributes, like `class`, that no module in the chunk used. The chunk was lowered without optimizing it.
