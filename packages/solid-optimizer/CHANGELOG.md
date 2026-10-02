# solid-optimizer

## 1.0.0-next.0

### Major Changes

- b7340c5: Targets Solid 2.0: `solid-js` 2 and `@solidjs/web`, with `@solidjs/vite-plugin` in the Vite plugin. Solid 1.x stays on the 0.x releases.

### Minor Changes

- fb9033c: Remove context providers whose readers are all visible, and give each `useContext` read the provider's value. Compound components like tabs and accordions now merge into one template. Set `contexts: false` to turn it off.
- 5df5b7c: Inline components imported from other modules in server builds and builds that hydrate too. The server and client builds copy the same components, so the hydration keys still match.
- c14d550: In chunk mode, inline components imported from other modules before bundling. The bundler then drops them and the runtime code only they used, so code-split builds shrink as much as single-chunk ones.
- 43e63de: Fold constants imported from other modules. `compile` takes them in `importedConstants`, and `readModuleConstants` reads them from a module. `solid-optimizer/vite` loads each imported module through the bundler, so a branch they fold away is gone before bundling, along with the built-ins and `lazy()` chunks only it used.
- 6e08e9a: Inline components that read their props through `merge()` and `omit()`. Each call site resolves the defaults it does not pass, and a spread of the rest becomes the attributes it passes.
- 383f572: The Babel plugin is replaced with a `compile` function for Solid 2.0. It runs on JSX before Solid's JSX transform.
  It inlines components into the JSX that uses them, so Solid creates fewer templates.
  It also folds constants and resolves `<Show>`, `<For>`, `<Repeat>`, `<Switch>`, and `<Dynamic>` when their props are constants.
  The SSR call removals from the Babel plugin are gone.
- a85033c: Inline a component only where its copies are no larger than the calls and declaration they replace, so the optimized output is never larger than the plain one because of inlining. The Vite plugin counts which modules use each export, so a component copied from another module only counts its declaration when the importer is its only user. `alwaysInline` restores inlining every component that can be.
- cc7ad74: Add `solid-optimizer/vite`, which replaces `@solidjs/vite-plugin` and takes the same options.
  Client builds that do not hydrate optimize each bundled chunk as a whole, so components inline across modules in the same chunk.
  Other builds optimize each module before Solid's JSX transform.

### Patch Changes

- 31cb0a1: Build faster. The parser hands over its AST through shared memory, a pass that changes nothing no longer makes the next one parse again, and source maps are only made when the build writes them.
- 5d8ea15: Fix chunk-mode builds that failed with "JSX expressions may not use the comma operator". Rolldown and Vite print `{(a, b)}` without its parentheses, and the plugin now puts them back.
- a85033c: In chunk mode, import the members that JSX tags like `<Button.Root>` read from a namespace import by name, so the bundle does not build a namespace object for them.
- a00bfc8: Keep a context provider around a value built from props by a function the optimizer does not know, like `mergeDefaultProps()`, or around a function declared outside it. Reading them can run code that reads the context.
