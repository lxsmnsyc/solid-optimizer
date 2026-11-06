---
"solid-optimizer": patch
---

Leave a package's own modules out of `optimizer.report`. They are compiled too, but the app cannot change what they leave alone, like Kobalte's own calls of `Polymorphic`. The app's calls of a package's components are still reported.
