---
'solid-optimizer': patch
---

`fold` no longer replaces a parameter default with a constant declared in the function body. When a parameter has a default or a computed key, the body now has its own scope, so `a = x` in `function C(props, a = x) { const x = "inner"; }` reads the outer `x`.
