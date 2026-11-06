---
"solid-optimizer": patch
---

In chunk mode, build each chunk with every component inlined that can be too, and keep the smaller of the two, minified and gzipped. The size estimate weighs each component on its own, so it missed runtime code that only goes once every call is inlined, like `<Dynamic>`, `merge()`, and `omit()` behind Kobalte's components. `examples/kobalte` drops from 18.20 kB to 12.28 kB gzipped.
