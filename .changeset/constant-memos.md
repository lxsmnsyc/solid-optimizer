---
"solid-optimizer": minor
---

Replace a `createMemo` whose computation folds to a literal with the literal at every call. Such a memo reads no signals, so its value never changes.
