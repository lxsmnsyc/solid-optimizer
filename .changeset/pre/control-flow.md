---
'solid-optimizer': minor
---

Lower control flow to cheaper code.

- A `<Show>` without `keyed` becomes a ternary, which Solid's JSX transform compiles to one memo instead of a component and three memos. A `<Switch>` of such `<Match>`es becomes a chain of ternaries. The front page of `examples/hackernews` creates 186 computations instead of 402, and the demo's builds are 270 to 290 B smaller gzipped. Set `conditionals: false`, or `optimizer.conditionals: false` in the Vite plugin, to keep both.
- A `<Show>` or `<Match>` with a callback child, like `{(user) => <Avatar user={user()} />}`, becomes a ternary too, when `when` reads names, members, and signal or memo getters. The tracker example's optimized build holds 10.7% less heap per mounted app.
- `<Dynamic component={Card}>` becomes `<Card>` when `Card` is a component declared at the top level that nothing reassigns, so it can inline like any other call.
- `<For>` over a constant list, including one written with `as const` or `satisfies`, unrolls into one copy of its row per item when that is no larger. The rows join the template around them.
