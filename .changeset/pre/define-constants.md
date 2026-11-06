---
"solid-optimizer": minor
---

Fold `define` entries and `import.meta.env` values in every build, module mode included, when all build environments share the value. `import.meta.env.SSR` never folds, so a server build and its client build fold the same values. `compile` takes them as `globalConstants`.
