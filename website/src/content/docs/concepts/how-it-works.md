---
title: How it works
description: The optimizer takes JSX in and gives JSX out, in rounds, before Solid's JSX transform lowers it.
type: concept
---

The input and the output of solid-optimizer are both JSX.

```text
your JSX ──▶ solid-optimizer ──▶ JSX ──▶ @solidjs/compiler ──▶ JavaScript
```

The optimizer never lowers JSX itself, so whatever Solid's JSX transform does with templates, events, and hydration stays the same. It is built for SolidJS 2.0 and `@solidjs/compiler`.

## Rounds

The optimizer runs its passes in rounds. One round can expose work for the next, such as an inlined component whose props now fold. It stops once a round changes nothing, or after `maxPasses` rounds, which is 10 by default.

After the rounds, `<Show>` and `<Switch>` are lowered to ternaries. They go last because the other passes read the `when` of `<Show>` and `<Match>` as a tracked place, and a ternary's condition is not one. A last step repairs elements that a pass put straight inside a parent that cannot hold them, which Solid's JSX transform rejects.

## What each pass is for

- [Folding and control flow](folding.md) folds constants, removes unreachable code, and resolves control flow whose props are constants.
- [Component inlining](component-inlining.md) replaces a component call with the component's JSX.
- [Context inlining](context-inlining.md) removes context providers whose readers are all visible.
- [Memo inlining](memo-inlining.md) replaces a memo that makes a new value and is read once with its computation.
- [Show and Switch lowering](show-switch.md) replaces `<Show>` and `<Switch>` with ternaries.

## Why fewer templates and owners is less work

Solid's JSX transform creates one template for each run of static markup, and the browser clones each template. A component call adds an owner, a props object, and its own templates.

- Inlining puts more markup in fewer templates, so the browser clones fewer of them.
- Removing a provider, inlining a component, or unrolling a list removes an owner, so the server sends fewer hydration keys and fewer component calls run.
- Lowering `<Show>` to a ternary replaces a component call, a props object, and three memos with one memo.
- Folding removes branches, and with them the imports and `lazy()` chunks only they used.

Removing an owner changes the hydration keys. See [Hydration](hydration.md).

## Related

- [Chunk and module mode](modes.md) for where the optimizer runs in a build.
- [Constants across modules](cross-module.md) for what folds across files.
- [Set up the Vite plugin](../guides/vite-plugin.md) to use it.
- [strategy.md](https://github.com/lxsmnsyc/solid-optimizer/blob/main/strategy.md) for the exact rules of each pass.
