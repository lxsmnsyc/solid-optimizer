---
"solid-optimizer": patch
---

Keep optimizing a client chunk when a component inlined there turns a spread into attributes, like `class`, that no module in the chunk used. The chunk was lowered without optimizing it.
