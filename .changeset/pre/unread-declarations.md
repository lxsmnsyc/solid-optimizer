---
'solid-optimizer': minor
---

Fold now removes a `const`, or a `let` nothing writes to, inside a function when nothing reads it and its initializer has no side effects. Folding often leaves such a declaration behind, like `const size = 'sm'` once every read of `size` became `"sm"`. The component then had a statement, so it did not inline where a statement has no place to go, such as a `<Show>` fallback. It now inlines there.
