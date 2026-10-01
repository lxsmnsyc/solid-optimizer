---
"solid-optimizer": minor
---

In chunk mode, inline components imported from other modules before bundling. The bundler then drops them and the runtime code only they used, so code-split builds shrink as much as single-chunk ones.
