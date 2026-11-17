---
'solid-optimizer': minor
---

Inline the components of headless libraries like Kobalte, which render through an alias, a `ref` array, `<Dynamic>`, and context.

- A call through an alias, like `<Separator />` with `const Separator = SeparatorRoot`, inlines as a call of the component it names. An alias nothing uses is removed with the component.
- Compound components inline, like `const Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger })`. `<Dialog>` is a call of `DialogRoot` and `<Dialog.Trigger>` is a call of `DialogTrigger`, when nothing writes to a member of the compound or of its root. The compound's statement goes away with its parts when nothing else reads it. This works where the compound and its calls are in one module or chunk.
- A `ref` array at a call site can hold `void 0` and `untrack(() => target)`, like `ref={[setRef, untrack(() => merged.ref)]}` once the call site passes no `ref`.
- `untrack(() => value)` folds to the value when the value is a constant.
- Context providers whose readers are all visible are removed, and each `useContext` read gets the provider's value. Compound components like tabs and accordions merge into one template. Set `contexts: false` to turn it off. A provider stays around a value built from props by a function the optimizer does not know, like `mergeDefaultProps()`, or around a function declared outside it.
- The size estimate measures a copy with the calls in it inlined, when the copy is what lets them inline, such as a call that spreads a `merge()` or `omit()` view.
