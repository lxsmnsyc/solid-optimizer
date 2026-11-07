---
'solid-optimizer': patch
---

A `<Show>` whose `fallback` is another `<Show>` that resolves to an expression no longer renders the expression's source as text. `<Show when={false} fallback={<Show when={false} fallback="a" />} />` rendered `"a"`, quotes included, because the outer `<Show>` read the inner one's already folded `"a"` as JSX.
