---
"solid-optimizer": minor
---

A `<Show>` without a callback child or `keyed` now becomes a ternary, which Solid's JSX transform compiles to one memo instead of a component and three memos. A `<Switch>` of such `<Match>`es becomes a chain of ternaries.

- The front page of `examples/hackernews` creates 186 computations instead of 402.
- The demo's builds are 270 to 290 B smaller gzipped, since `Switch`, `Match`, and `children()` leave the bundle.
- Set `conditionals: false`, or `optimizer.conditionals: false` in the Vite plugin, to keep both.
