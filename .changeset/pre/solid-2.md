---
'solid-optimizer': major
---

Support Solid 2.0. The optimizer targets `solid-js` 2 and `@solidjs/web`, and `solid-optimizer/vite` needs `@solidjs/vite-plugin` `^3.0.0` and `vite` 8 or 9. Solid 1.x users stay on `solid-optimizer@0`, which gets fixes from the `0.x` branch.

The Babel plugin is replaced with a `compile` function. It runs on JSX before Solid's JSX transform. It inlines components into the JSX that uses them, so Solid creates fewer templates. It also folds constants and resolves `<Show>`, `<For>`, `<Repeat>`, `<Switch>`, and `<Dynamic>` when their props are constants. The SSR call removals from the Babel plugin are gone.

Add `solid-optimizer/vite`, which replaces `@solidjs/vite-plugin` and takes the same options. Client builds that do not hydrate optimize each bundled chunk as a whole, so components inline across modules in the same chunk. Other builds optimize each module before Solid's JSX transform. Modules whose extension is listed in the `extensions` option, like `.mdx`, are optimized too, and an extension listed with `typescript: true` is parsed as TypeScript. `.tsrx` stays out, since the official plugin compiles it on its own path.
