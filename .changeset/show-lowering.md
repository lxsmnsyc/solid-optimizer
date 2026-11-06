---
"solid-optimizer": minor
---

A `<Show>` without a callback child or `keyed` now becomes a ternary, which Solid's JSX transform compiles to one memo instead of a component and three memos. The front page of `examples/hackernews` creates 186 computations instead of 402. Set `shows: false`, or `optimizer.shows: false` in the Vite plugin, to keep `<Show>`.
