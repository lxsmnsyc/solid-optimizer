---
'solid-optimizer': minor
---

Fold more constants.

- `define` entries and `import.meta.env` values fold in every build, module mode included, when all build environments share the value. `import.meta.env.SSR` never folds, so a server build and its client build fold the same values. `compile` takes them as `globalConstants`.
- Constants imported from other modules fold. `compile` takes them in `importedConstants`, and `readModuleConstants` reads them from a module. `solid-optimizer/vite` loads each imported module through the bundler, so a branch they fold away is gone before bundling, along with the built-ins and `lazy()` chunks only it used. A module is not loaded when the importer only uses its bindings as types.
- Constants exported from a module with JSX fold in module mode as well as chunk mode, and a server build and its hydrating client build fold the same ones.
- A `createMemo` whose computation folds to a literal becomes the literal at every call.
- A signal that nothing writes becomes its value. When the setter is left out, as in `const [size] = createSignal(3)`, or nothing references it, and the value is a literal with no options, every call of the getter becomes the literal. This also works at module scope, and an exported getter stays. A memo whose value can be a promise or an async iterable is kept.
- `createSignal` and `createStore` are marked `/* @__PURE__ */` when their first argument is a literal, an object, or an array, so the bundler drops one that folding left unused.
