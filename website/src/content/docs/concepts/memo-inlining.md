---
title: Memo inlining
description: A memo that always makes a new value and is read once is replaced with its computation.
type: feature
---

A `createMemo` whose result is new on every run, such as an object, array, or JSX, never stops an update. When it is also read once, as the whole of a tracked JSX expression, the read runs the computation itself.

```tsx compare="input"
const style = createMemo(() => ({ color: color() }));
return <p style={style()} />;
```

```tsx compare="output"
return <p style={{ color: color() }} />;
```

## Why

A memo that always makes a new value cannot skip an update, so it only adds an owner and a cache. Removing it saves both. Leave the pass on unless you rely on the memo's owner.

## How it works

Three cases use the same idea, that the read can do the work itself.

### A new value on every run

The memo in the example above. It is read once, as the whole of a tracked JSX expression.

### A constant

A memo whose computation folds to a literal never changes. Every call of it becomes the literal, however many there are, when each call comes after the declaration and nothing else uses the memo.

```tsx compare="input"
const size = createMemo(() => 1 + 2);
return <p>{size() * 2}</p>;
```

```tsx compare="output"
return <p>{6}</p>;
```

A signal that nothing writes works the same way: `const [size] = createSignal(3)`, or one whose setter nothing references. With a literal and no options, every call of the getter becomes the literal, under the same conditions. This also works outside a function, since a signal takes no owner.

### A plain arrow

A plain arrow that only returns an expression, like `const label = () => (props.open ? 'Close' : 'Open')`, has no cache and no owner, so each call becomes its body. That needs every call to come after the declaration with no arguments, nothing else to use the arrow, and every name in the body to mean the same at the call. With more than one call, the body is copied only when the copies are no larger than the arrow and its calls, minified.

### The `children` helper

Solid's `children` helper over JSX, read once as an element's child, becomes that JSX. The helper resolves JSX the same way inserting it does, and nothing makes it run again.

```tsx compare="input"
const c = children(() => <b>x</b>);
return <div>{c()}</div>;
```

```tsx compare="output"
return (
  <div>
    <b>x</b>
  </div>
);
```

This is what a component that calls `children(() => props.children)` leaves once it is inlined with JSX children.

## Usage

The pass runs by default. To turn it off:

```ts title="vite.config.ts"
solid({ optimizer: { memos: false } });
```

## Options

| Option  | Default | Effect                    |
| ------- | ------- | ------------------------- |
| `memos` | `true`  | Turns the pass on or off. |

## Limits and caveats

- A memo with options other than `{ equals: false }` stays.
- A memo with `equals: false` that may return a promise or an async iterable stays.
- A memo read more than once, read other than as a call with no arguments, or read somewhere other than the whole of a tracked JSX expression stays, unless it folds to a constant.
- A declaration with more than one binding, or outside a function, stays.

See [Report reasons](../reference/reasons.md#memo-pass) for the codes.

## Related

- [Folding and control flow](folding.md) for what folds a memo to a constant.
- [Component inlining](component-inlining.md) for the `children` helper case.
- [Report reasons](../reference/reasons.md#memo-pass) for why a memo stays.
- [strategy.md](https://github.com/lxsmnsyc/solid-optimizer/blob/main/strategy.md) for the exact rules.
