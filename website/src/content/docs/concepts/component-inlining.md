---
title: Component inlining
description: A component call is replaced with the component's JSX, so more markup lands in fewer templates.
type: feature
---

```tsx compare="input"
function Title(props) {
  return <h1 class="title">{props.label}</h1>;
}

export function App() {
  return (
    <main>
      <Title label="Hello" />
    </main>
  );
}
```

```tsx compare="output"
export function App() {
  return (
    <main>
      <h1 class="title">{'Hello'}</h1>
    </main>
  );
}
```

Solid then creates one template for `<main>` instead of two.

## Why

A component call costs a call, a props object, an owner, and its own template. Inlining removes all four when the component is small and its props are visible at the call. Reach for it, or leave it on, in any app with small presentational components.

It does not apply when the component is not visible to the optimizer, such as a `lazy()` component, or when the copies would be larger than the calls. Use [`optimizer.report`](../guides/report.md) to see why a component stays.

## How it works

The optimizer reads each top-level component and each call of it, and decides per call.

- A read of `props.name` becomes the attribute's expression. Solid passes dynamic props as getters, so the expression runs at every read, as before.
- A static prop that must be evaluated once, like a function read twice, is stored in a `const` first.
- `{props.children}`, and a prop whose value is JSX, splice their JSX in place so it joins the template.
- Statements in the component body move into the function whose returned JSX holds the call: a component, the child callback of `<For>` or `<Repeat>`, the child callback of `<Show>` or `<Match>` when it takes the value, or the callback given to `render`.
- Bindings declared in the component get fresh names in every copy.
- A component nothing else uses is removed, with any alias of it that nothing uses.

### When a component inlines

- It is declared once at the top level, with a capitalized name.
- A call through an alias, like `const Separator = SeparatorRoot`, is a call of the component it names.
- So is a call through a compound component, like Kobalte's `const Dialog = Object.assign(DialogRoot, { Trigger: DialogTrigger })`. `<Dialog>` calls `DialogRoot` and `<Dialog.Trigger>` calls `DialogTrigger`, as long as nothing writes to a member of either.
- Its parameter is one identifier that is only read as `props.name`, spread onto an element as `{...props}`, or passed to `merge()` and `omit()`.
- Its body ends in the only `return`, and that `return` returns JSX.
- It does not use `this`, `arguments`, `super`, or `new.target`.
- The call site has no spread attribute and no namespaced attribute.
- A `ref` at the call site moves to the element the component gives `props.ref` to, when its value is a name, a function, or an array of them. In an array, `void 0` and `untrack(() => ...)` around a name or a function count too.

### Only where it is smaller {#only-where-it-is-smaller}

Every copy repeats the component's own code, so inlining a component at many calls can make the output larger. Before inlining, each component's copies are compared with what they replace, as Solid's JSX transform would lower them. A copy saves the component call and the getters of its props. It costs the component's statements, its dynamic attributes and children, and the elements that cannot join a template.

A small component, or one used once, inlines at every call. A wrapper used many times, whose root is another component, stays a component. Set `alwaysInline` to inline every component that can be.

The estimate weighs each component on its own, so it cannot see runtime code that only goes once every call that needs it is inlined, like `<Dynamic>`, `merge()`, and `omit()` behind a headless library's components. In chunk mode, each chunk is also built with every component inlined that can be, and the smaller one, minified and gzipped, is kept.

## Usage

### Props with defaults

The props can go through `merge()` and `omit()` first, declared as a `const` in the component.

```tsx
function Button(props) {
  const merged = merge({ type: 'button' }, props);
  const rest = omit(merged, 'label');
  return <button {...rest}>{props.label}</button>;
}
```

- A default has to be a literal, like `'button'`, `0`, or `false`.
- `omit()` has to name its keys as string literals.
- A view can only be read as `view.name`, spread onto an element, or passed to another `merge()` or `omit()`.
- A spread becomes the attributes the call site passes, and it cannot repeat an attribute the element already has.

### Inline every component that can be

```ts title="vite.config.ts"
solid({ optimizer: { alwaysInline: true } });
```

### Inline components from a package

List the package in `optimizer.packages`. See [Inline components from packages](../guides/packages.md).

## Options

| Option                   | Default | Effect                                                                    |
| ------------------------ | ------- | ------------------------------------------------------------------------- |
| `inline`                 | `true`  | Turns the pass on or off.                                                 |
| `alwaysInline`           | `false` | Inlines every component that can be, even where the copies are larger.    |
| `alwaysInlineComponents` | `[]`    | Top-level components to inline wherever they can be.                      |
| `sharedComponents`       | none    | Components other modules use too, by the number of modules that use them. |

See [compile and readModuleConstants](../reference/compile.md) and [Vite plugin options](../reference/vite-options.md).

## Limits and caveats

- A prop called as `props.name()` runs with its own receiver as `this`, not the props object.
- Moved statements run before the host's JSX is created. The order of effect registration between siblings can change.
- Inlining removes an owner, so the hydration keys change. See [Hydration](hydration.md).
- A component that is not declared at the top of the same module or chunk is not inlined by this pass. `lazy()` components, imports, components declared inside a function, and globals stay. Imported components of a [listed package](../guides/packages.md) are copied in first.

## Related

- [Report reasons](../reference/reasons.md) for every reason a call stays.
- [Context inlining](context-inlining.md) for providers that inlining makes visible.
- [Chunk and module mode](modes.md) for where components inline.
- [Find out why a component stays](../guides/report.md) to read the report.
