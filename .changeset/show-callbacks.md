---
"solid-optimizer": minor
---

A `<Show>` or `<Match>` with a callback child, like `{(user) => <Avatar user={user()} />}`, now becomes a ternary too. The body reads `when` again wherever it read the accessor, which only happens when `when` reads names, members, and signal or memo getters, like `user()` or `errors[id]`. The tracker example's optimized build holds 10.7% less heap per mounted app.
