---
"solid-optimizer": minor
---

Turn a call of an arrow function whose body is JSX into that JSX, when it is an element's child and its arguments are constants. A render prop called with a constant, such as `props.children(1)`, now joins the template once the component is inlined.
