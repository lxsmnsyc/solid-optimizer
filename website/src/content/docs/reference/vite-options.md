---
title: Vite plugin options
description: Every option of solid-optimizer/vite, with its type and default.
type: reference
---

```ts
import solid from 'solid-optimizer/vite';

solid(options?: Options): Plugin[];
```

The plugin takes every option of `@solidjs/vite-plugin`, plus `optimizer`. The optimizer reads some of them too:

- `solid.moduleName` for where Solid's built-ins come from.
- `solid.builtIns` for their names.
- `extensions` for which modules it optimizes.

Entries are in the order of the `optimizer` object, passes last.

## optimizer {#optimizer}

Type: `OptimizerOptions | false`

Default: `{}`

`false` uses `@solidjs/vite-plugin` as it is. Every other option of the plugin is passed to `@solidjs/vite-plugin`.

## optimizer.mode {#optimizer-mode}

Type: `'auto' | 'module'`

Default: `'auto'`

`'auto'` uses chunk mode for client builds that do not hydrate and set neither `babel` nor `compiler: 'babel'`, and module mode for everything else, serving included. `'module'` never keeps JSX through bundling. See [Chunk and module mode](../concepts/modes.md).

## optimizer.dev {#optimizer-dev}

Type: `boolean`

Default: `false`

Also optimizes while serving, in module mode.

## optimizer.report {#optimizer-report}

Type: `boolean | ((report: OptimizerReport) => void)`

Default: `false`

Reports what stays as written in each build, and why. `true` prints it. A function receives it instead, once per build environment. See [Find out why a component stays](../guides/report.md).

## optimizer.packages {#optimizer-packages}

Type: `readonly string[]`

Default: `[]`

Packages whose components are copied into the modules that use them, like `['@kobalte/core']`. A package has to publish its JSX, as most Solid libraries do through the `solid` export condition. Re-exports and aliases like `const Button = ButtonRoot` are followed. Their copies inline wherever they can be, so the bundler drops the originals, even when the package lands in another chunk. A listed package has to be bundled in every build, or the server and client builds copy different components. See [Inline components from packages](../guides/packages.md).

## optimizer.inline {#optimizer-inline}

Type: `boolean`

Default: `true`

Component inlining. Works like the [compile option](compile.md#inline).

## optimizer.alwaysInline {#optimizer-always-inline}

Type: `boolean`

Default: `false`

Inlines every component that can be, even where the copies are larger than the calls. Works like the [compile option](compile.md#always-inline).

## optimizer.contexts {#optimizer-contexts}

Type: `boolean`

Default: `true`

Context provider removal. Works like the [compile option](compile.md#contexts).

## optimizer.memos {#optimizer-memos}

Type: `boolean`

Default: `true`

Memo inlining. Works like the [compile option](compile.md#memos).

## optimizer.conditionals {#optimizer-conditionals}

Type: `boolean`

Default: `true`

`<Show>` and `<Switch>` lowering. Works like the [compile option](compile.md#conditionals).

## optimizer.fold {#optimizer-fold}

Type: `boolean`

Default: `true`

Constant folding and control-flow resolution. Works like the [compile option](compile.md#fold).

## optimizer.maxPasses {#optimizer-max-passes}

Type: `number`

Default: `10`

The most rounds to run. Compilation stops early once a round changes nothing.

## Limits

- The plugin optimizes the modules the official plugin lowers: `.jsx` and `.tsx` (with their `.m` and `.c` forms), plus the `extensions` it registers, such as `.mdx`, filtered by `include` and `exclude`.
- `.tsrx` modules are the exception. The official plugin lowers them on its own path, and they are not optimized.
- Chunk mode is skipped when the `babel` option is set or `compiler` is `'babel'`, since those passes need each module.
- An export named `__so_local$name` is added to a module for each local binding its exported components need, so a copy in another module can import it. In chunk mode, entry modules get none.
- A component used in several chunks is copied into each of them, where each copy is no larger than its call.
- Components from dependencies in `node_modules` are only copied from the packages `optimizer.packages` lists.

## Related

- [Set up the Vite plugin](../guides/vite-plugin.md) for the steps.
- [compile and readModuleConstants](compile.md) for the options these share.
- [Errors](errors.md) for the warnings the plugin prints.
