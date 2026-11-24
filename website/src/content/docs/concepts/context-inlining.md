---
title: Context inlining
description: A context provider whose readers are all visible is removed, and each read gets the provider's value.
type: feature
---

```tsx compare="input"
const Theme = createContext();

function Label() {
  const theme = useContext(Theme);
  return <span class={theme}>label</span>;
}

export function App() {
  return (
    <main>
      <Theme value="dark">
        <Label />
      </Theme>
    </main>
  );
}
```

```tsx compare="output"
export function App() {
  const theme$1 = 'dark';
  return (
    <main>
      <span class={'dark'}>label</span>
    </main>
  );
}
```

## Why

A provider is a component with an owner, and each reader walks up to find it. When the optimizer can see every reader, the value goes straight to them and the provider is not needed.

Leave it on when your providers wrap code made of elements, Solid's built-ins, and small components. Turn it off with `contexts: false` when you need the owners to stay.

## How it works

The optimizer reads everything under the provider. When every reader is one it can see, it removes the provider and gives each read the provider's value.

- Everything under the provider has to be visible: intrinsic elements, Solid's built-ins, and components that inline. A call to an unknown function, or a read of a component's `props`, keeps the provider.
- An object value is stored in a `const` once, so every reader gets the same object.
- The value must never be `undefined`.

A provider of an imported context can be removed like a local one when `compile` gets the context's export in `importedContexts`.

## Usage

Nothing to write. The pass runs by default. To turn it off:

```ts title="vite.config.ts"
solid({ optimizer: { contexts: false } });
```

To see which providers stayed, turn on [the report](../guides/report.md). Their reasons are in the provider pass table of [Report reasons](../reference/reasons.md#provider-pass).

## Options

| Option             | Default | Effect                                                             |
| ------------------ | ------- | ------------------------------------------------------------------ |
| `contexts`         | `true`  | Turns the pass on or off.                                          |
| `importedContexts` | none    | The exports of imported modules that are contexts. `compile` only. |

## Limits and caveats

- Removing the provider removes its owner, so the hydration keys change. See [Hydration](hydration.md). Compile a server build and its client build with the same options.
- A provider whose value could be `undefined`, or whose tag has attributes other than `value`, stays.
- A provider of the same context under another one stays.

## Related

- [Component inlining](component-inlining.md) makes more readers visible.
- [Report reasons](../reference/reasons.md#provider-pass) for why a provider stays.
- [strategy.md](https://github.com/lxsmnsyc/solid-optimizer/blob/main/strategy.md) for the exact rules.
