---
'solid-optimizer': patch
---

`fold` no longer replaces a `let` with its initial value when a TypeScript namespace body or an enum initializer writes to it. Namespace bodies and enum initializers are now part of the scope analysis. `namespace A.B {}` now declares `A`, and an enum initializer reads earlier members of the enum before outer bindings.
