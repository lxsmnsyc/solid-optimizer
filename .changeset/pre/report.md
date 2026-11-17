---
'solid-optimizer': minor
---

Add `optimizer.report`, which lists each component call, provider, and memo the optimizer left alone, and why. `compile` takes `report` and returns the list in `skipped`. A package's own modules are left out, since the app cannot change what they leave alone. The app's calls of a package's components are still reported.
