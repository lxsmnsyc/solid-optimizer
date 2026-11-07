---
'solid-optimizer': minor
---

Compound components now inline, like Kobalte's `const Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger })`. `<Dialog>` is a call of `DialogRoot`, since `Object.assign` returns its first argument, and `<Dialog.Trigger>` is a call of `DialogTrigger`. The tags are renamed when nothing writes to a member of the compound or of its root. Once its tags are renamed and nothing else reads it, the compound's statement goes away, even when its parts stay calls. `Object.assign` no longer keeps the parts an app never renders, so the bundler drops them. The Kobalte example with a `<Tabs>` added is 2.8% smaller in one chunk.

This works where the compound and its calls are in one module or chunk. Copying the parts of a compound from another module is not done yet.
