---
"solid-optimizer": patch
---

Move a component's statements to the `return` that holds its call. A function with several `return`s put every copy's statements before the first one, so a later `return` read bindings from a block it could not see and threw a `ReferenceError`.
