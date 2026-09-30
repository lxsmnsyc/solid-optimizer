# Optimization strategy

This document records how each optimization is decided: what the runtime does, when a rewrite keeps the same behavior, and what it accepts as different. Every rewrite has to render the same DOM and update it the same way as the unoptimized build.

## Build phases

In chunk mode, the Vite plugin optimizes twice: once per module while modules are transformed, and once per chunk in `renderChunk`.

Rolldown removes unused code from each chunk after `renderChunk`, so code a chunk rewrite stops using still disappears. What `renderChunk` cannot change is what bundling already decided:

- A dynamic import in a branch that folds away still becomes its own chunk.
- A chunk still exports what another chunk stopped using, since chunks render in parallel.

So each part runs where it has the most effect.

| Part                               | Transform | `renderChunk` | Why                                                                    |
| ---------------------------------- | --------- | ------------- | ---------------------------------------------------------------------- |
| Fold, module constants             | yes       | yes           | Dead branches leave the module graph before bundling.                  |
| Fold, constants from other modules | yes       | yes           | The plugin reads them from the imported modules.                       |
| Memo inlining                      | yes       | yes           | Reads that are only direct once a component is inlined need the chunk. |
| Component inlining                 |           | yes           | It needs to know which components share the chunk.                     |
| Helper marker                      | yes       |               | It has to survive bundling.                                            |
| Lowering and helper linking        |           | yes           | Only possible once the chunk is final.                                 |

To fold a constant imported from another module, the plugin resolves each import and reads the module from disk, as written. It keeps `export const` bindings whose value folds, a `let` the module never writes to, and names re-exported from another such module. It skips dependencies, virtual modules, and modules with a query. A value another plugin would rewrite, like a `define` replacement, is not a literal on disk, so it does not fold. This is what lets a shared runtime chunk drop `<Dynamic>` or `<Show>` when a constant from a config module folds them away everywhere.

The helper marker only keeps the built-ins a module still uses after folding, so an import that folding left unused does not keep the export alive.

A call to Solid's `lazy` is marked `/* @__PURE__ */`. It only creates a component and loads nothing until it renders, so the bundler can drop one a folded branch left unused, along with its dynamic import.

Builds that hydrate run everything while modules are transformed, since the server and client build split chunks differently.

## Context inlining

Status: proposed, not implemented.

### What a provider costs

In Solid 2.0, a context is its own provider component (`createContext` in `solid/src/client/core.ts`):

```js
function provider(props) {
  return createRoot(() => {
    setContext(provider, props.value);
    return children(() => props.children);
  });
}
```

Each provider instance costs:

- a component call;
- a root owner, which is not transparent and takes a hydration id;
- a copy of the context object, since `setContext` spreads `_context`;
- two lazy memos from the `children()` helper.

The provider element is also a component boundary, so the templates on either side of it cannot merge.

### Why the value can be passed directly

- `props.value` is read once, untracked, when the provider is created. Every `useContext(Ctx)` under it returns that same value, and later changes to the prop are not seen. So a `useContext(Ctx)` can be replaced with a `const` evaluated where the provider was created.
- The root takes the parent's queue (`_queue: parent._queue`), so `<Loading>` and `<Errored>` behave the same without it.
- The root is a child of the host's owner. Cleanups and effects under it keep the same lifetime when they move to the host.

The number of consumers does not matter. Every consumer under the provider reads the same value, so one consumer or many are rewritten the same way.

### When the rewrite is sound

Every code path that can call `useContext` under the provider instance has to be visible and rewritten.

1. The tag resolves to a top-level `createContext(...)` from `solid-js` that is never reassigned. Exporting it is fine, since other provider instances are not affected.
2. The subtree is closed. After inlining, the children contain:
   - no component calls, except Solid's built-ins, whose child callbacks are checked too;
   - no calls to unknown functions, since a helper like `useTheme()` can read the context. Signal and memo reads and `useContext` itself are fine.
   - no `getOwner`, `runWithOwner`, `lazy`, or `<Dynamic>` of an unknown component.
3. Nested providers of the same context are rewritten innermost first. A read under an inner provider belongs to that provider.
4. The value is evaluated once, where the provider was created. It becomes a `const` in the host component, unless it is a literal or a binding that never changes.

### The blocking case

The common consumer reads the context in a statement:

```jsx
function Label() {
  const theme = useContext(Theme);
  return <span>{theme}</span>;
}
```

The inline pass never inlines such a component inside a provider, since a provider is a component and statements only move out of intrinsic elements. That rule is what keeps context reads correct today. It also means the subtree is never closed, so the provider can never be removed.

Removing the provider and inlining the consumers therefore has to happen as one step:

1. Inline copies of the consumers into the provider's host, and replace their `useContext(Theme)` with the stored value.
2. Remove the provider.
3. Splice its children into the host's template.

### Accepted differences

- Removing the root changes the hydration keys under it. Module mode is safe, since the server and client build rewrite the same way. Chunk mode only runs for builds that do not hydrate.
- A `useContext` inside an event handler throws today, because it runs without an owner. Rewritten, it would return the value. Reads inside `on*` handlers are left alone to avoid this.
- A subtree that calls `getOwner` is not rewritten, since the owner it gets back would change.

### Where it helps

Compound components that share context between a parent and its parts in the same module or chunk, such as tabs, accordions, form fields, and select menus. Headless UI libraries are built this way. App-wide providers around routes, lazy chunks, and library components almost never have a closed subtree.

### Plan

1. Remove a provider when its subtree is closed and nothing in it reads the context, for example after folding removed the only consumer. Keep the value's side effects.
2. Replace reads that are `useContext(Ctx)` directly in JSX, then remove the provider.
3. Inline consumers that read the context in statements, together with removing the provider.

## Memo inlining

Status: implemented in `packages/solid-optimizer/src/memo.ts`.

### What a memo does

`createMemo` in Solid 2.0 (`signals/src/signals.ts` and `computed` in `signals/src/core/core.ts`):

- computes once when it is created, unless `lazy` is set;
- shares its result with every reader;
- notifies its readers only when the result changes, by reference equality unless `equals` says otherwise;
- takes a slot in the owner tree, and with it a hydration id;
- passes its last result to the computation as `prev`.

### When a memo does nothing

A memo whose result is new on every run notifies its readers on every run, so its equality check never stops an update. A result is new every run when the computation returns an object, array, function, class, `new` expression, or JSX, or when the memo sets `equals: false`.

Such a memo still shares its result. That only matters with more than one read, or with a read that runs more often than the memo recomputes. So the memo is replaced with its computation when all of these hold:

- It is `createMemo` from Solid, called inside a function, with a computation that takes no parameter and only returns an expression. `equals: false` is the only option allowed.
- The result is new on every run, as described above.
- It is read exactly once, as `memo()`, and nothing else references it.
- The read is the whole of a tracked expression: a JSX child of an intrinsic element or fragment, an attribute of an intrinsic element other than an event handler or `ref`, or a tracked prop of a built-in (`<Show when>`, `<Match when>`, `<For each>`, `<Repeat count>`). The reader then depends on exactly what the memo depended on.
- The read runs once each time the function holding the memo runs. It sits in the JSX that function returns, with only intrinsic elements and fragments around it, and not inside a loop, a callback, or a component's children.
- Every name in the computation means the same at the read, and the computation uses no `this`, `arguments`, `await`, or `yield`.

```jsx
const style = createMemo(() => ({ color: color() }));
return <p style={style()} />;
```

becomes

```jsx
return <p style={{ color: color() }} />;
```

In chunk mode, the Vite plugin records which chunk binding is `createMemo`, the same way it records the built-in components.

### Accepted differences

- The computation first runs when its reader first runs, instead of when the memo is created.
- The memo no longer takes a slot in the owner tree, so the hydration keys after it shift. A server build and its client build must compile with the same options.

### Not covered yet

- Calls that always return a new value, such as `Array.from`, `.map`, or `.filter`. Knowing that needs the receiver's type, so they are not treated as new today. Spreading the result into an array literal, as in `[...list.map(fn)]`, makes it count.
- A memo read once inside another computation, such as the compute function of `createMemo` or `createEffect`. The same rule applies when the read is that function's whole return value.
- A memo with no reactive reads at all, whose value never changes. It could become a plain value, but proving that a call reads nothing needs knowledge of every callee.
