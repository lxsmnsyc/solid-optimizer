---
'solid-optimizer': minor
---

Inline more components, and only where the output does not grow.

- A component is inlined only where its copies are no larger than the calls and declaration they replace, so the optimized output is never larger than the plain one because of inlining. The Vite plugin counts which modules use each export, so a component copied from another module only counts its declaration when the importer is its only user. `alwaysInline` restores inlining every component that can be. The size estimate sees the top-level constants a copy folds, so a component that renders a constant list passed by name, like `rows={ROWS}`, inlines where that makes the output smaller.
- Components imported from other modules inline in client, server, and hydrating builds. The server and client builds copy the same components, so the hydration keys still match. A component that only returns a call of a component from its own module, like an icon that wraps `<Icon>`, is not copied, since the copy saves nothing.
- A component that spreads its props onto an element, like `<div {...props} />`, inlines. The spread becomes the attributes and children each call site passes.
- A component that reads its props through `merge()` and `omit()` inlines. Each call site resolves the defaults it does not pass, and a spread of the rest becomes the attributes it passes.
- A component called with a `ref` it forwards to an element, like `<Field ref={el} />` with `<input ref={props.ref} />`, inlines. The call site's `ref` moves to that element.
- A component with statements inlines inside the child callback of `<For>` or `<Repeat>`, the child callback of `<Show>` or `<Match>` that takes the value, and the callback given to `render`. These callbacks run untracked once per item or value, like a component.
- A component that has statements keeps the call when they assign to something declared outside it, like a counter at the top of the module, since a copy's statements run before the JSX around the call. `optimizer.report` gives these calls the reason `component-write`.
- Solid's `children` helper becomes its JSX when it is read once as an element's child, so a component that resolves `props.children` this way merges its children into its template.
- A derived arrow like `const label = () => (props.open ? 'Close' : 'Open')` becomes its body at each call, so a constant can fold and join the template. With more than one call, the body is copied only when that is no larger.
- A call of an arrow function whose body is JSX becomes that JSX, when it is an element's child and its arguments are constants. A render prop called with a constant, such as `props.children(1)`, joins the template once the component is inlined.
- Fold removes a `const`, or a `let` nothing writes to, inside a function when nothing reads it and its initializer has no side effects, so the component has no statement left and inlines where a statement has no place to go, such as a `<Show>` fallback.
- A pass does not put an element where the HTML parser would move it, like a `<div>` inside a `<p>`. Each template is checked the way Solid checks it, and an element that would move stays in `{}`, inserted at runtime.
