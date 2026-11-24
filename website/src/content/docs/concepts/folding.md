---
title: Folding and control flow
description: Constants fold, branches that never run are removed, and control-flow components with constant props resolve at build time.
type: feature
---

Constant expressions fold, and control flow whose outcome is known is resolved. A constant list in a `<For>` unrolls.

```tsx compare="input"
const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
];

<nav>
  <For each={LINKS}>{(link) => <a href={link.href}>{link.label}</a>}</For>
</nav>;
```

```tsx compare="output"
<nav>
  <a href={'/'}>{'Home'}</a>
  <a href={'/docs'}>{'Docs'}</a>
</nav>
```

This follows the `optimize` option of `@solidjs/compiler` ([solidjs/solid#3231](https://github.com/solidjs/solid/pull/3231)).

## Why

Code that cannot run still costs bytes, and a branch that folds away takes its imports and `lazy()` chunks with it. Folding also makes work for the other passes, such as a prop that becomes a constant after inlining.

Leave it on. Turn it off with `fold: false` when you need the written code to reach Solid's JSX transform as it is.

## How it works

- Constant expressions fold, including `const` bindings and `let` bindings nothing writes to, at any scope.
- Branches that a constant condition never takes are removed. So are statements after a `return`, `throw`, `break`, or `continue`.
- `<Show when>` becomes its children or its `fallback`.
- `<For each>` becomes its `fallback` when `each` is an empty array literal or a falsy constant.
- `<Repeat count>` becomes its `fallback` when `count` is below one.
- `<Switch>` drops each `<Match>` that is always false, and becomes the first `<Match>` that is always true.
- `<Dynamic component="div">` becomes `<div>`. `<Dynamic component={Card}>` becomes `<Card>` when `Card` is a capitalized component declared at the top level, as a function or with `lazy`, that nothing reassigns. An imported component stays, since an import could hold a tag name.
- `untrack(() => value)` becomes the value when the value is a constant. A component inlined with a literal prop can leave one, like `untrack(() => props.as)`.
- A call of an arrow function whose body is JSX, such as a render prop left by inlining, becomes the JSX when it is an element's child and each argument is a constant or a binding nothing reassigns. `{((n) => <li>{n}</li>)(1)}` becomes `<li>{1}</li>`. A `ref` or a spread in the JSX keeps the call, since both run while the JSX is made.

Constants from other modules fold too. See [Constants across modules](cross-module.md).

## Usage

### Constant lists

`<For>` over a constant list becomes one copy of its row per item, when the copies are estimated to be no larger than the loop.

- The list is an array literal, or a `const` of one that only `<For>` reads and that is not exported.
- Each item is a primitive literal, or an object literal of them.
- The row is an arrow function whose body is JSX without a `ref` or a spread, and reads the item as `item.key`, or as itself when it is a primitive.
- The output lowers to one template.

### Names the optimizer treats as built-ins

A built-in only folds when the tag resolves to Solid's component. The tag must bind to nothing, or be imported from one of `moduleSources`. A bundler can rename a built-in in a chunk, so `builtInAliases` maps those names back.

### Side effects and `lazy`

A call to Solid's `lazy` is marked `/* @__PURE__ */`, so the bundler drops one that a folded branch left unused, along with its chunk. `createContext` is marked too, and so are `createSignal` and `createStore` whose first argument is a literal, an object, or an array.

A condition that is discarded but has side effects still runs. `[effect()] && value` becomes `([effect()], value)`.

## Options

| Option              | Default                        | Effect                                                                                  |
| ------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| `fold`              | `true`                         | Turns the pass on or off.                                                               |
| `builtIns`          | Solid's built-ins              | The names of Solid's built-in components. An empty list turns control-flow folding off. |
| `moduleSources`     | `['solid-js', '@solidjs/web']` | The modules the built-ins are imported from.                                            |
| `builtInAliases`    | none                           | Top-level names that refer to built-ins.                                                |
| `constantVars`      | `false`                        | Treats a top-level `var` that nothing writes to as a constant.                          |
| `importedConstants` | none                           | Constants of imported modules.                                                          |
| `globalConstants`   | none                           | Values of global names and paths.                                                       |

See [compile and readModuleConstants](../reference/compile.md) for each one.

## Limits and caveats

- A tag with a spread attribute or a function child never folds.
- `<Portal>`, `<Loading>`, `<Errored>`, and `<Reveal>` never fold.
- Unrolling a `<For>` removes the loop. Each row had its own owner, so this shifts the hydration keys after it. See [Hydration](hydration.md).

## Related

- [Constants across modules](cross-module.md) for constants from other files.
- [Show and Switch lowering](show-switch.md) for conditions that are not constant.
- [Memo inlining](memo-inlining.md) for memos that fold to a constant.
- [compile and readModuleConstants](../reference/compile.md) for the options.
