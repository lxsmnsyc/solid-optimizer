---
"solid-optimizer": patch
---

Keep a context provider around a value built from props by a function the optimizer does not know, like `mergeDefaultProps()`, or around a function declared outside it. Reading them can run code that reads the context.
