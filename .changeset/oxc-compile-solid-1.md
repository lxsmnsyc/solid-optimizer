---
"solid-optimizer": minor
---

The Babel plugin is replaced with a `compile` function for Solid 1.x. It runs on JSX before Solid's JSX transform.
It inlines components into the JSX that uses them, so Solid creates fewer templates.
It folds constants and resolves `<Show>`, `<For>`, `<Index>`, `<Switch>`, and `<Dynamic>` when their props are constants, and inlines memos whose caching does nothing.
`solid-optimizer/vite` replaces `vite-plugin-solid` and takes the same options.
The SSR call removals from the Babel plugin are gone.
