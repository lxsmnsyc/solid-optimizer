---
"solid-optimizer": minor
---

The Babel plugin is replaced with a `compile` function for Solid 2.0. It runs on JSX before Solid's JSX transform.
It inlines components into the JSX that uses them, so Solid creates fewer templates.
It also folds constants and resolves `<Show>`, `<For>`, `<Repeat>`, `<Switch>`, and `<Dynamic>` when their props are constants.
The SSR call removals from the Babel plugin are gone.
