---
'solid-optimizer': minor
---

Compound components now inline, like Kobalte's `const Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger })`. `<Dialog>` is a call of `DialogRoot`, since `Object.assign` returns its first argument, and `<Dialog.Trigger>` is a call of `DialogTrigger`. The tags are renamed when nothing writes to a member of the compound or of its root. The compound's statement goes away with its parts when nothing else reads it.

This works where the compound and its calls are in one module or chunk. Copying the parts of a compound from another module is not done yet.
