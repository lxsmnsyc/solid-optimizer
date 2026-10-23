---
"solid-optimizer": minor
---

Inline components that read their props through `merge()` and `omit()`. Each call site resolves the defaults it does not pass, and a spread of the rest becomes the attributes it passes.
