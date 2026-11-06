---
"solid-optimizer": patch
---

Read the app's modules through a virtual entry, like the server entry `@solidjs/vite-plugin` generates with `start`. The usage index could not read such an entry, so the server build treated every export as used anywhere and inlined fewer components than the client build. Hydration then met different markup and failed.
