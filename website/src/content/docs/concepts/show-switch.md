---
title: Show and Switch lowering
description: A Show without keyed becomes a ternary, and a Switch of Match children becomes a chain of ternaries.
type: feature
---

A `<Show>` without `keyed` becomes a ternary. Solid's JSX transform compiles the ternary to one memo, where `<Show>` costs a component call, a props object, and three memos.

```tsx compare="input"
<Show when={props.user} fallback={<a href="/login">Sign in</a>}>
  {(user) => <b>{user().name}</b>}
</Show>
```

```tsx compare="output"
<>{props.user ? <b>{props.user.name}</b> : <a href="/login">Sign in</a>}</>
```

## Why

`<Show>` and `<Switch>` are components, so each costs a call, a props object, and owners. The ternary has the same meaning in the cases below and costs one memo. Leave it on unless you need the component to stay.

## How it works

This pass runs after the others, since they read `when` of `<Show>` and `<Match>` as a tracked place, and a ternary's condition is not one. A lowered one can hold another, which the next round lowers.

- A callback child becomes its body, with each read of its parameter written as `when` again. This only happens when `when` reads names, members, and signal or memo getters, so reading it again gives the same value.
- A `<Switch>` whose children are all `<Match>`es that lower becomes a chain of ternaries. Each later condition gets its own memo, read only when the ones before it are falsy, as `<Switch>` reads them.

## Usage

The pass runs by default. To turn it off:

```ts title="vite.config.ts"
solid({ optimizer: { conditionals: false } });
```

## Options

| Option         | Default | Effect                    |
| -------------- | ------- | ------------------------- |
| `conditionals` | `true`  | Turns the pass on or off. |

## Limits and caveats

- A spread attribute, `keyed`, or a callback child whose body could render differently keeps the component.
- `<Show>`'s accessor throws when it is read after the condition turns falsy. The lowered code reads the falsy value instead.
- When `when` is a constant, [folding](folding.md) resolves the `<Show>` before this pass.

## Related

- [Folding and control flow](folding.md) for constant conditions.
- [How it works](how-it-works.md) for where this pass runs.
- [compile and readModuleConstants](../reference/compile.md#conditionals) for the option.
