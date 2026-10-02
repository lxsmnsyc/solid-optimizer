---
"solid-optimizer": patch
---

In chunk mode, import the members that JSX tags like `<Button.Root>` read from a namespace import by name, so the bundle does not build a namespace object for them.
