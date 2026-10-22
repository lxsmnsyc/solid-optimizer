---
"solid-optimizer": minor
---

Inline components that have statements inside the child callback of `<For>` or `<Repeat>`, the child callback of `<Show>` or `<Match>` that takes the value, and the callback given to `render`. These callbacks run untracked once per item or value, like a component, so the statements move into them.
