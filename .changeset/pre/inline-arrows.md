---
"solid-optimizer": minor
---

A derived arrow like `const label = () => (props.open ? 'Close' : 'Open')` now becomes its body at each call, so a constant can fold and join the template. Each call has to come after the declaration with no arguments, and nothing else may use the arrow. With more than one call, the body is copied only when that is no larger.
