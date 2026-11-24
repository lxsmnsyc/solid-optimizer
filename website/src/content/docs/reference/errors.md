---
title: Errors
description: Each error and warning that solid-optimizer prints or throws, with its cause and fix.
type: reference
---

```text
[solid-optimizer] <file>: <message>
```

Every message starts with `[solid-optimizer]`. Entries below are in the order a build meets them.

## Parse failure {#parse-failure}

Message: `[solid-optimizer] <file>: <code frame>`

Thrown by `compile` and `readModuleConstants` as a `SyntaxError`. The message is the parser's code frame, or its message when it has no code frame.

Cause: the code does not parse as JSX or TypeScript. `filename` picks the parser, so `.ts`, `.tsx`, `.mts`, and `.cts` parse as TypeScript and anything else as JSX.

Fix: correct the syntax at the code frame, or pass the right `filename`.

In the Vite plugin, a module that does not parse is skipped when constants are read, and its own transform reports the error.

## External package {#external-package}

Message: `[solid-optimizer] <package> is external in this build, so its components are not copied. Bundle it, like with `ssr.noExternal`, so every build copies the same components.`

A warning, printed once for each package and build environment.

Cause: a package in `optimizer.packages` is external, like a server build that leaves it to Node. Its components are not copied there, so a build that copies them would hydrate different markup.

Fix: bundle the package in every build. For a server build, add it to `ssr.noExternal`. See [Inline components from packages](../guides/packages.md).

## Missing helper {#missing-helper}

Message: `[solid-optimizer] <chunk> needs "<helper>" from "<moduleName>", but no module in the chunk imports it. <chunk> is not optimized.`

A warning, in chunk mode. The report also lists a `missing-helper` skip with the chunk's file name.

Cause: the optimizer merged markup into a tree that needs a runtime helper none of the chunk's modules imports, such as one for a less common attribute like `style`. Solid's JSX transform adds helper imports per module, and the chunk has no name for this one.

Fix: none is needed for the output to be correct. The chunk is lowered as its modules were written, so it is not optimized. To optimize it, set `optimizer.mode` to `'module'`, which does not link helpers by chunk.

## No top-level target {#no-top-level-target}

Message: `[solid-optimizer] <chunk> has no top-level "<target>" for "<imported>".`

An internal error. Report it as a bug.

Cause: in chunk mode, the chunk's helper map points `<imported>` at a name that the chunk does not declare at the top level.

Fix: set `optimizer.mode` to `'module'` until it is fixed, and [open an issue](https://github.com/lxsmnsyc/solid-optimizer/issues) with the chunk and its input modules.

## Shadowed target {#shadowed-target}

Message: `[solid-optimizer] <chunk> shadows "<target>" where the JSX transform uses "<imported>".`

An internal error. Report it as a bug.

Cause: in chunk mode, a local binding in the chunk hides the top-level name that stands for a helper, at a place where the lowered JSX uses that helper.

Fix: set `optimizer.mode` to `'module'` until it is fixed, and [open an issue](https://github.com/lxsmnsyc/solid-optimizer/issues) with the chunk and its input modules.

## Empty document {#empty-document}

Message: `[solid-optimizer] no <<name>> in an empty document`

An internal error. Report it as a bug.

Cause: after a pass, the optimizer checks where a browser would put an element, by parsing a fixed empty HTML document. The document had no `<html>` or `<body>` element, which should not happen.

Fix: [open an issue](https://github.com/lxsmnsyc/solid-optimizer/issues) with the code that triggers it.

## Related

- [Report reasons](reasons.md) for what the report lists.
- [Chunk and module mode](../concepts/modes.md) for the two modes.
- [Vite plugin options](vite-options.md) for `optimizer.mode`.
