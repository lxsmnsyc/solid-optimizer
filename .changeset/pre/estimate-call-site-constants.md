---
"solid-optimizer": patch
---

Measure a component's copy with the top-level constants its module declares, so the size estimate sees a list or condition that the copy folds once inlined. A component that renders a constant list passed by name, like `rows={ROWS}`, now inlines where that makes the output smaller.
