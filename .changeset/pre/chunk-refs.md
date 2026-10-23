---
"solid-optimizer": patch
---

Fix a `ref` that names a variable, like `let el; <input ref={el} />`, in client builds that keep JSX through bundling. The bundler only saw `el` read, so it folded later reads of `el` to `undefined`.
