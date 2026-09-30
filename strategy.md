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

To fold a constant imported from another module, the plugin resolves each import with `this.resolve` and loads the module with `this.load`. It reads the loaded code, which every other plugin has already transformed. It keeps `export const` bindings whose value folds, a `let` the module never writes to, `export default` of a constant, and names re-exported from another such module, including through `export *`. A read of `ns.NAME` through `import * as ns` folds too. This is what lets a shared runtime chunk drop `<Dynamic>` or `<Show>` when a constant from a config module folds them away everywhere. See [Constants from other modules](#constants-from-other-modules) for the cases this was checked against.

The helper marker only keeps the built-ins a module still uses after folding, so an import that folding left unused does not keep the export alive.

A call to Solid's `lazy` is marked `/* @__PURE__ */`. It only creates a component and loads nothing until it renders, so the bundler can drop one a folded branch left unused, along with its dynamic import.

Builds that hydrate run everything while modules are transformed, since the server and client build split chunks differently.

## Context inlining

Status: implemented. See [How it is built](#how-it-is-built).

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

### How it is built

A provider is removed in two steps, in two passes of the same round.

1. The inline pass looks for closed providers that have components under them. It treats each one like an intrinsic element, so consumer statements can move out through it. A value that is not a literal or a binding that never changes is stored in a `const` of the host first, and the provider takes that `const`. In each inlined copy, `useContext(Ctx)` becomes the value.
2. The provider pass removes a closed provider with no components under it. It replaces the reads left in its JSX and turns it into a fragment.

A subtree is closed when it contains only:

- intrinsic elements, fragments, Solid's built-ins other than `<Dynamic>`, and other providers;
- components the inline pass can inline, whose own code is closed;
- calls to Solid's primitives and to signal, store, and memo accessors;
- method calls on an object literal, reached through bindings that never change or through the provider's value, when the method is an accessor or a closed function.

A read of a parameter's member, other than the component's own props, counts as unknown code. So do spreads, `new`, tagged templates, and dynamic imports. A function given to an `on*` attribute is skipped. It runs with no owner, so a `useContext` in it throws with or without the provider.

The value must never be `undefined`, since `useContext` would then fall back to the default or throw. It has to be a literal other than `undefined`, an object, array, function, class, JSX, or template literal, a signal accessor, or a binding that never changes and holds one of those.

### Not covered yet

- A provider in a callback, like a `.map()` or `<For>` child, with a value that has to be stored. The `const` needs a place that runs once per provider.
- A consumer whose context value is used as something other than an object literal or an accessor, such as a store or a class instance.
- Providers in other modules. Hydrating builds only see one module at a time.

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

## Constants from other modules

Status: implemented.

The plugin reads imported constants from the module the bundler loads, not from the file on disk. These cases were checked against a build without the optimizer.

Folded, with the same output:

- A relative import, including `./config.js` that resolves to `config.ts`.
- `resolve.alias`, `resolve.tsconfigPaths`, and a plugin that redirects an import in `resolveId`.
- A virtual module, with or without the `\0` prefix.
- A plugin whose `load` hook replaces a real file, and a plugin that rewrites the module in `transform`. Reading from disk gave the wrong value in both cases.
- JSON imports, `export *` barrels, `export default`, namespace imports, and imports that form a cycle.

Correct, but only folded in `renderChunk`:

- `define` and `import.meta.env`. Rolldown replaces them after transform, so the loaded code still holds the identifier.
- A constant exported from a module with JSX. See below.

Never folded:

- A `let` the module writes to, a `const enum`, and dependencies in `node_modules`.
- Any import while serving. The dev server does not return the code of a loaded module.

A module with JSX is never loaded. This plugin's transform can be waiting for that module while that module waits for this one. Two JSX modules that import each other then never finish. The probe that loaded them hung.

### Comma expressions in JSX

Rolldown and `vite:oxc` print a comma expression that is the whole of a JSX expression container without its parentheses. JSX does not allow that, so the next parse fails. A fold that keeps a side effect makes such an expression, as in `{[effect()] ? 'on' : 'off'}`. Rolldown also makes one from that code on its own, with every pass turned off. Chunk mode puts the parentheses back after `vite:oxc` and before `renderChunk` parses the chunk.

This is a bug in the oxc code generator, which both `vite:oxc` and Rolldown use. It is not reported upstream yet. The smallest reproduction, with Vite 8.3.1 and Rolldown 1.2.11:

```js
import { transformWithOxc } from 'vite';

const result = await transformWithOxc('export const a = <p>{(b(), c)}</p>;', 'a.jsx', {
  jsx: 'preserve',
});
result.code; // export const a = <p>{b(), c}</p>;
```

Once oxc prints the parentheses, `repairJSXSequences` in `vite/runtime.ts` and its two call sites can be removed.

## Component inlining across modules

Status: proposed, not implemented.

Hydrating builds only inline components defined in the same module. Most apps keep one component per file, so those builds gain little. The plan is to inline an imported component while its importer is transformed, using the same resolve step as constants. The server and client builds see the same modules, so they make the same decisions.

This would also shrink shared runtime chunks in chunk mode. In the demo, `Tab` spreads a view of its props and reads a context. The chunk step inlines it and removes the provider, but the runtime chunk still exports `spread`, `merge`, `omit`, `createContext`, and `useContext`, because `Tabs.tsx` needed them when Rolldown split the chunks.

### Where the component's code comes from

- Resolving is not the problem. Every import goes through `this.resolve`, so aliases, tsconfig paths, and resolver plugins apply.
- The file on disk is not safe to read. A plugin that replaces or rewrites the module makes it wrong, as the constant probes showed.
- `this.load` returns the code after Solid's JSX transform in module mode, so the JSX is gone.
- `this.load` on a module with JSX can deadlock when two modules import each other.

A way through is to record the code of each JSX module at the point this plugin sees it, before Solid's transform. The importer then waits for that record with a check for cycles: it keeps a graph of which transform waits on which, and gives up on an import that would close a cycle. The recorded code misses what plugins after this one do, which has to be accepted or detected.

### When a component can move

Everything the component's body refers to must be reachable from the importer:

- Its props, Solid's exports, and globals.
- Bindings its module exports, which the importer can import by the module's resolved id.

A reference to a private binding of its module keeps the call. So does a component that other plugins transform, such as one using macros or auto-imports.

### Cost

- The importer gains imports.
- A component that is still called elsewhere keeps its definition, so its code can appear twice. A size limit is needed, such as only moving JSX-only components or components used once.

## Solid 1 catch-up

Status: planned.

- Port the demo, its report, and the browser check to the `solid-1-compiler` branch, so both branches have the same regression check.
- Open a pull request for the Solid 1 branch.
