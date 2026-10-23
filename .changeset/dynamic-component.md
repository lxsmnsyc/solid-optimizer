---
"solid-optimizer": minor
---

Turn `<Dynamic component={Card}>` into `<Card>` when `Card` is a component declared at the top level that nothing reassigns. The component can then inline like any other call.
