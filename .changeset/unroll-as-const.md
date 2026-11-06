---
"solid-optimizer": patch
---

`<For>` over a constant list written with `as const` or `satisfies`, like `const LINKS = [...] as const`, now unrolls like a list without them.
