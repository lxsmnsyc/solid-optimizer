---
"solid-optimizer": minor
---

A signal that nothing writes now becomes its value. When the setter is left out, as in `const [size] = createSignal(3)`, or nothing references it, and the value is a literal with no options, every call of the getter becomes the literal, so it can fold and join the template. This also works at module scope, and an exported getter stays.
