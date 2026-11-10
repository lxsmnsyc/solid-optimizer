---
'solid-optimizer': patch
---

Optimize modules whose extension is listed in the `extensions` option, like `.mdx`, the same way `@solidjs/vite-plugin` lowers them. Before, only `.jsx` and `.tsx` modules were optimized, so a module with a listed extension was lowered without being optimized. An extension listed with `typescript: true` is parsed as TypeScript. `.tsrx` stays out, since the official plugin compiles it on its own path.
