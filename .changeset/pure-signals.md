---
"solid-optimizer": minor
---

`createSignal` and `createStore` are now marked `/* @__PURE__ */` when their first argument is a literal, an object, or an array, so the bundler drops one that folding left unused. `createContext` was already marked, along with `lazy`. A call given a function stays unmarked, since it creates a computation that runs it.
