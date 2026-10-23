---
"solid-optimizer": minor
---

Replace Solid's `children` helper with its JSX when it is read once as an element's child. A component that resolves `props.children` this way now merges its children into its template once it is inlined.
