---
"solid-optimizer": minor
---

Inline a component called with a `ref` it forwards to an element, like `<Field ref={el} />` with `<input ref={props.ref} />`. The call site's `ref` moves to that element.
