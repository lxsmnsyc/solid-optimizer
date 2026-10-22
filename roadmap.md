# Optimizer roadmap

This lists what the optimizer does not do yet, whether it is worth doing, and the plan for each item that is. Items are in the order they should land. Each item was checked against the `solid-2-compiler` branch with `compile` and `alwaysInline: true`, unless it says otherwise.

## Step 0: measure first

Every item below guesses at how often a case shows up in real apps. Measure before building.

1. Add a debug option that records why each pass left something alone. Give each reason a short code, such as `call-spread`, `call-ref`, `param-spread`, `no-host`, `size`, `provider-open`, or `memo-shape`.
2. Report the counts per reason from the Vite plugin when the option is set.
3. Run it on the demo and Hacker News. solid-ui only builds on `solid-1-compiler`, since its libraries are not on Solid 2 yet. Run the Solid 1 version of the option there as a rough check for the library wrapper items.
4. Reorder the items below if the counts disagree with this order.

The option stays after the work is done. It helps explain future size results.

## 1. Components with statements inside `<For>` and `<Show>`

A component with statements does not inline inside a `<For>` callback or a `<Show>` child. A component whose body is only JSX does.

```jsx
function Row(props) {
  const [on, setOn] = createSignal(false);
  return <li onClick={() => setOn(!on())}>{props.name}</li>;
}

<For each={items()}>{(item) => <Row name={item.name} />}</For>; // not inlined
```

Statements only move into a component, since a component runs untracked. List rows and conditional panels have this shape, so this is likely the most common case in real apps.

Plan:

1. Read Solid 2's `mapArray` and `repeat`. Confirm that a `<For>` or `<Repeat>` callback runs once per item, untracked, under its own owner.
2. If it does, treat such a callback as a host. Move the statements into its body. Turn an expression body into a block with a `return`.
3. For a `<Show>` or `<Match>` child, the call is already the root of its own template, so nothing merges. Check whether `untrack(() => { ...statements; return <jsx />; })` is smaller than the component call. Only do this part if the estimate says it is.
4. Fix the context case at the same time. A provider in a `<For>` callback can store its value in a `const` in the callback once the callback is a host. It is blocked today even when the value is already stored in the callback.

Tests:

- A row with a signal inside `<For>`, `<For keyed={false}>`, and `<Repeat>`.
- A row that reads the item or the index accessor in its statements.
- A provider in a `<For>` callback whose value is stored.
- Runtime equivalence in `behavior.test.ts` when items are added, removed, and moved.

## 2. Spreads and `ref` in component inlining

See [inline-spread-plan.md](inline-spread-plan.md). In short:

- `<div {...props} />` inside a component blocks the component everywhere. This is the cheapest fix.
- `ref` at a call site blocks it. Allow it when the component only forwards `props.ref` to an element.
- A spread of an unknown object at a call site blocks it. Store `merge(...)` in the host and keep the views as real calls.

## 3. Memos whose computation is a constant

`createMemo(() => 1 + 2)` folds to `createMemo(() => 3)` and stays a memo. A computation that folds to a literal reads no signals, so its value never changes.

Plan:

1. In `memo.ts`, accept a memo whose computation returns a literal after folding, or a binding that never changes and holds one.
2. Replace every read `m()` with the literal, however many reads there are. Drop the declaration.
3. Keep the same rules for what else may reference the memo. A memo passed as a value stays.

This shifts the hydration keys after the memo, which is already an accepted difference of memo inlining.

## 4. `<Dynamic>` with a known component

`<Dynamic component="h1">` already becomes `<h1>`. `<Dynamic component={Title}>` stays, even when `Title` is a top-level component that is never reassigned.

Plan:

1. In `fold.ts`, rewrite `<Dynamic component={X} ...>` to `<X ...>` when `X` is a top-level binding that is never reassigned, or an import, with a capitalized name.
2. The inline pass then treats it like any other call.
3. List the accepted difference in `strategy.md`. `<Dynamic>` creates a memo for the component, so removing it shifts the hydration keys after it.

## 5. The `children()` helper read once

```jsx
function Box(props) {
  const c = children(() => props.children);
  return <div>{c()}</div>;
}
```

After inlining this becomes `const c$1 = children(() => <b>x</b>); <div>{c$1()}</div>`. The helper resolves the children and shares the result, like a memo. Libraries use it often.

Plan:

1. In `memo.ts`, treat `children(() => expr)` from Solid like a memo whose result is new on every run.
2. Use the same rules as memo inlining. It is read exactly once, as the whole of a tracked JSX child, and runs once each time its function runs.
3. Replace the read with `expr`. Solid's JSX transform resolves a child the same way `children()` does.
4. Check `children()` in Solid 2 first. If it does more than resolve and share, such as flattening arrays in a way `insert` does not, restrict the rule to children that are JSX elements.

## 6. A render prop called with constant arguments

```jsx
function List(props) {
  return <ul>{props.children(1)}</ul>;
}

<List>{(n) => <li>{n}</li>}</List>;
```

After inlining this becomes `<ul>{((n) => <li>{n}</li>)(1)}</ul>`. The `<li>` cannot join the `<ul>` template.

Plan:

1. Reduce a call of an arrow function whose body is only JSX, when each argument is a literal or a binding that never changes. Replace each parameter with its argument and drop the call.
2. This keeps the same updates. Every use of a parameter sits in a JSX expression, which the JSX transform wraps in its own effect. So the outer call never tracks anything the body reads.
3. Leave the call alone when the body has statements, or a parameter is used in a way that is not a plain read.

## 7. `<For>` and `.map()` over a constant list

`<For each={[]}>` already folds to its fallback. A constant list with items does not fold:

```jsx
const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
];

<For each={LINKS}>{(link) => <a href={link.href}>{link.label}</a>}</For>;
```

Navigation bars, footers, and feature lists on static pages look like this.

Plan:

1. Unroll `<For>` when `each` folds to an array literal whose items fold to constants, and the callback body is only JSX. Each copy replaces the item with its value and `index()` with its number. With `keyed={false}`, the item is an accessor and the index a number, so `item()` becomes the value instead.
2. Unroll `{LIST.map((item, index) => <jsx />)}` the same way. The receiver is a known array literal, so `.map` is known to be the array method.
3. Use the size estimate. Unrolling a long list can be larger than the loop.
4. List the accepted difference. `<For>` gives each item its own owner, so unrolling shifts the hydration keys.

## 8. Copying components from chosen packages

Components from `node_modules` are never copied across modules. Headless libraries like Kobalte are where context inlining would help most.

Plan:

1. Check which Solid libraries publish their JSX source through the `solid` export condition. A package that only publishes lowered code cannot be copied.
2. Add `optimizer.packages`, a list of package names to copy from. Do not turn it on for every package by default.
3. In `copyImported` and the usage index in `vite/index.ts`, let resolved ids from those packages through.
4. Treat every export of a package as used elsewhere. A package's exports are its public API, and other packages can import them too.
5. Add no `__so_local$` exports to package modules. Copy a component only when everything it needs is exported or imported already.
6. Build solid-ui with `@kobalte/core` listed, and compare with the current numbers.

## 9. Constants in hydrating builds

Hydrating builds and server builds always run in module mode. Constants exported from a module with JSX do not fold there. `define` and `import.meta.env` do not fold either.

Plan:

1. Constants from a module with JSX. Component copying already loads such modules safely. Chunk mode records which modules each transform waits for, and module mode uses the import graph on disk. Read the constants through the same loader and the same checks.
2. `define` and `import.meta.env`. Read the values from the resolved Vite config and fold them like imported constants.
3. Do not fold a value that can differ between the server and the client build, such as `import.meta.env.SSR` or a `define` set per environment. The size estimate could then decide differently in each build, and the hydration keys would not match.

## 10. Class instances as context values

A store as a context value already works. `strategy.md` still lists stores as not covered, so fix that line.

A class instance does not work:

```jsx
<Ctx value={new Api()}>
  <Label />
</Ctx>
```

`new` counts as unknown code, and a method of a class is not checked the way a method of an object literal is.

Plan:

1. Accept `new` of a top-level class that is never reassigned, whose constructor and methods are closed.
2. Accept a method call on its instance when the method is closed.
3. Store the instance in a `const` in the host, as an object literal value is stored today.

This is less common than the items above. Do it only if step 0 finds it.

## 11. Runtime helpers in the size estimate

The estimate does not count runtime helpers that the bundle drops once their last use is gone. In the demo, inlining `Tab` drops `merge`, `omit`, `spread`, and `useContext`, worth several kilobytes. That only happened because `Tab` was worth inlining for its own sake.

This needs research before a plan:

- The dry run in `inject.ts` already knows which helpers each function needs.
- A helper only leaves the bundle when no module in any chunk uses it. Knowing that needs a build-wide record of helper users, built the same way in every build.
- Module mode must not let this record depend on the transform order, or hydration breaks.

Start with a prototype that only works in chunk mode. Measure it on solid-ui, where most wrappers are declined today.

## Not planned

These are known gaps that are not worth doing now.

- **Memos of `.map`, `.filter`, or `Array.from`.** Knowing the result is new needs the receiver's type. Assuming it is an array is unsound for other receivers.
- **A memo read once inside another computation.** Only safe when the read is the whole return value, which is rare.
- **Providers in other modules.** App-wide providers wrap routes and lazy chunks, so their subtree is almost never closed.
- **How copies change Rolldown's chunk split.** No plan without a case that shows a loss.
- **Components that another plugin transforms after this one, in module mode.** Chunk mode covers it.
- **`const enum`, the `babel` option, and `.tsrx` modules.** These depend on other tools.
- **Destructured props and early returns that read props.** Both break reactivity in Solid, so idiomatic code does not use them. Early returns on a constant already fold away.
- **Namespaced attributes on a component call, such as `on:click`.** Rare on components.
