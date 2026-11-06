---
"solid-optimizer": patch
---

An expression with type arguments, like `(() => <div />)<T>`, is now seen through the same as `as`, `satisfies`, and `!`, so it is optimized instead of passed through.
