---
"solid-optimizer": minor
---

Inline the components of headless libraries like Kobalte, which render through an alias, a `ref` array, and `<Dynamic>`.

- A call through an alias, like `<Separator />` with `const Separator = SeparatorRoot`, inlines as a call of the component it names. An alias nothing uses is removed with the component.
- A `ref` array at a call site can hold `void 0` and `untrack(() => target)`, like `ref={[setRef, untrack(() => merged.ref)]}` once the call site passes no `ref`.
- `untrack(() => value)` folds to the value when the value is a constant.
- The size estimate measures a copy with the calls in it inlined, when the copy is what lets them inline, such as a call that spreads a `merge()` or `omit()` view.
- In chunk mode, a module that spreads onto `<Dynamic>` keeps the helpers a `ref` and a link need, so the chunk can still be optimized once `<Dynamic>` becomes an element.
