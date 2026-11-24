---
title: Hydration
description: A server build and its client build must compile the same way, or their hydration keys differ.
type: concept
---

The output changes the shape of the rendered tree, and with it the hydration keys. Inlining a component, removing a provider, or unrolling a list removes an owner. Compile a server build and its client build from the same code with the same options.

> [!NOTE]
> **Compile both builds the same way.**
> Different options, or different decisions about the same code, give the server and the client different trees.

## What changes the keys

- [Component inlining](component-inlining.md) removes the component's owner.
- [Context inlining](context-inlining.md) removes the provider's owner.
- [Folding](folding.md) of a `<For>` over a constant list unrolls it. Each row had its own owner, so the keys after it shift.

## What the plugin does

The Vite plugin does this for you. A hydrating build runs in module mode, where every decision depends only on the modules, never on how the bundler splits chunks. A server build and its client build split chunks differently, so decisions that depend on chunks would differ.

Module mode also keeps two modules that import each other from copying each other's components, and it copies components of a listed package only when the package is bundled. A listed package has to be bundled in every build.

## What you do

- Use the same `optimizer` options in the server build and the client build.
- Bundle the packages in `optimizer.packages` in every build.
- If you use `compile` directly, pass the same options for both.

## Related

- [Chunk and module mode](modes.md) for how `'auto'` picks a mode.
- [Inline components from packages](../guides/packages.md) for bundling listed packages.
- [Use compile without Vite](../guides/compile-api.md) for the API.
