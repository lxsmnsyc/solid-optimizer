---
title: Chunk and module mode
description: The Vite plugin optimizes either each chunk or each module, and the build picks which.
type: concept
---

The plugin optimizes in one of two modes.

|                     | Chunk mode                        | Module mode                                              |
| ------------------- | --------------------------------- | -------------------------------------------------------- |
| Used for            | Client builds that do not hydrate | Everything else, serving included                        |
| Unit                | A whole chunk                     | A module, with the components it imports copied in first |
| Decisions depend on | How the bundler splits chunks     | Only the modules                                         |

## Chunk mode

Chunk mode is for client builds that do not hydrate. Constants fold and memos inline in each module first, so a branch that folds away takes its imports and `lazy()` chunks out of the bundle. Components imported from other modules are inlined there too, so the bundler drops them and the runtime code only they used.

JSX is then kept through bundling. Each chunk is optimized as a whole and then lowered by Solid's JSX transform, so a component inlines anywhere in its chunk.

Each chunk is also built with every component inlined that can be, and the smaller of the two, minified and gzipped, is kept. The size estimate weighs each component on its own, so it cannot see runtime code that only goes once every call that needs it is inlined. See [Component inlining](component-inlining.md#only-where-it-is-smaller).

## Module mode

Module mode is for everything else. Each module is optimized before the official plugin lowers it, with the components it imports from other modules copied in first. A server build and its client build split chunks differently, and hydration needs both to render the same tree, so every decision depends only on the modules. Two modules that import each other do not copy each other's components.

## When `'auto'` picks each

`optimizer.mode` is `'auto'` by default. It uses chunk mode when all of these hold, and module mode otherwise:

- the build is a build, not serving
- it is a client build
- it does not hydrate
- neither the `babel` option nor `compiler: 'babel'` is set

Set `optimizer.mode` to `'module'` to use module mode everywhere.

## What mode changes in the output

- A module gets an export named `__so_local$name` for each local binding its exported components need, so a copy in another module can import it. In chunk mode, entry modules get none.
- A component used in several chunks is copied into each of them, where each copy is no larger than its call.

## Related

- [Hydration](hydration.md) for why hydrating builds use module mode.
- [Vite plugin options](../reference/vite-options.md#optimizer-mode) for the option.
- [Constants across modules](cross-module.md) for what both modes fold.
- [Set up the Vite plugin](../guides/vite-plugin.md) to change the mode.
