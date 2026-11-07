---
'solid-optimizer': patch
---

A text that a nested fold produced no longer merges with the JSX text beside it. `<span><Show when={true}><Show when={true}>a</Show></Show>` followed by `x` on the next line rendered `a x` instead of `ax`, because JSX turns a line break between two texts into a space once they are one text node. Nested fragments did the same.
