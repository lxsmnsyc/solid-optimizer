---
'solid-optimizer': patch
---

Keep a memo whose value can be a promise or an async iterable. A memo waits for one, and the read it was inlined into took the value as it is, so Solid threw `SYNC_NODE_RECEIVED_ASYNC`. This covers `createMemo(() => new Promise(...))`, an object literal with `then`, and a memo with `equals: false` that returns a call or a member read. A memo with `equals: false` is still inlined when its value is a literal, a template, an operator result, or a fresh array, object, function, or JSX element.
