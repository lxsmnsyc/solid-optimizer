# Optimizer roadmap

This lists what the optimizer does not do yet, whether it is worth doing, and the plan for each item that is. Items are in the order they should land. Each item was checked against the `solid-2-compiler` branch with `compile` and `alwaysInline: true`, unless it says otherwise.

## Step 0: measure first

Status: done. `optimizer.report` and the `compile` option `report` list what each pass leaves alone, with a reason code. Set `REPORT=1` when building the demo or Hacker News to print it. See [Report](packages/solid-optimizer/README.md#report) for the codes.

What the demo and Hacker News report on `solid-2-compiler`, with the default chunking:

| App         | Reason                  | Calls | What it is                                                                               |
| ----------- | ----------------------- | ----- | ---------------------------------------------------------------------------------------- |
| Demo        | `no-host`               | 2     | `Home` in a `fallback`, and `App` in the callback given to `render`.                     |
| Demo        | `copy-size`, `imported` | 3     | `Table` and `Card`, which measured larger copied than called. Both inline since item 11. |
| Demo        | `lazy`                  | 4     | The lazy pages.                                                                          |
| Hacker News | `copy-no-host`          | 1     | `Comment` in a `<For>` callback. It also renders itself.                                 |
| Hacker News | `copy-package`          | 4     | The router's own components, which come from `node_modules`.                             |
| Hacker News | `memo-computation`      | 2     | Memos in the router whose computation is a block, not one expression.                    |

What this changes:

- Item 1 is confirmed. Both apps have a call that only stays because it sits in a built-in's child or callback. The callback given to `render` is a third place that could take statements.
- Item 2 cannot be measured on Solid 2 yet. Neither app has a spread or a `ref` at a call site. Its value has to come from solid-ui on `solid-1-compiler`, which needs the report ported there first.
- Item 9 is confirmed in a small way. The router is the only `node_modules` code either app renders.
- No provider in the apps' own code stays, so item 10 and the provider half of item 1 have no measured case yet.
- The router's `RouteContextObj` and `RouterContextObj` show up as components, not providers. They come from `routing.js`, which has no JSX, so no marker tells the chunk step which binding is `createContext`. Their subtrees call `c.outlet()`, so they would stay anyway.

## 1. Components with statements inside `<For>` and `<Show>`

Status: steps 1, 2, and 4 are done. Step 3 is not planned. See below.

A component with statements did not inline inside a `<For>` callback or a `<Show>` child. A component whose body is only JSX did.

```jsx
function Row(props) {
  const [on, setOn] = createSignal(false);
  return <li onClick={() => setOn(!on())}>{props.name}</li>;
}

<For each={items()}>{(item) => <Row name={item.name} />}</For>; // now inlined
```

Statements only moved into a component, since a component runs untracked.

What Solid 2.0.0-rc.16 does, from its source:

- `<For>` calls `mapArray`. Each item's callback runs in `runWithOwner(createOwner(), ...)`, which turns tracking off, once per item while the item stays. `keyed={false}` does the same once per index.
- `<Repeat>` calls `repeat`, which runs each index's callback the same way.
- `<Show>` and `<Match>` call a child callback with `untrack` only when it takes a parameter. A callback without one is inserted as a child, which tracks it.
- `<Show>` children and `fallback` that are not callbacks are read inside the condition's memo. A component there is made by `createComponent`, which is `untrack(() => Comp(props))`.
- `render` calls its callback once inside `createRoot`, which also turns tracking off.

Plan:

1. Done. The reading above confirms it.
2. Done. The callbacks of `<For>` and `<Repeat>`, the callbacks of `<Show>` and `<Match>` that take a parameter, and the callback given to `render` take statements. `hydrate` is left out, since the server build renders with `renderToString` and would not inline the same way.
3. Not planned. A `<Show>` child or a `fallback` has no function to hold statements. `untrack(() => { ...statements; return <jsx />; })` keeps what `createComponent` does. The call is already the root of its own template there, so this only saves the component call. The demo's `Home` in a `fallback` was transformed by hand in the built output and measured with Vite's minifier:

   | Chunking | `createComponent(() => {...})` | `untrack(() => {...})` |
   | -------- | ------------------------------ | ---------------------- |
   | default  | -17 B min, -10 B gzip          | -16 B min, -7 B gzip   |
   | vendor   | -15 B min, -10 B gzip          | not possible           |
   | single   | -16 B min, -2 B gzip           | -16 B min, -10 B gzip  |
   - About 16 B minified per call. The demo has one such call and Hacker News has none, so it is not worth a new host in the inline pass, a size estimate, and tests.
   - `untrack` is not imported by the app chunk in `vendor` mode, so that form needs a name the chunk does not have.
   - `createComponent(() => { ...statements; return <jsx />; })` avoids that. `createComponent` is `untrack(() => Comp(props || {}))`, and the call site already imports it. Use this form if an app turns up with many such calls.

4. Done for storing the value. A provider in a `<For>` callback stores its value in a `const` in the callback, and its readers inline. The provider itself still stays when its value reads the callback's item, since the item could hold a function that a child calls. That rule is not changed.

Results: the demo's `App` now inlines into the callback given to `render`, and the default build is 12 B smaller. Hacker News does not change, since `Comment` renders itself.

## 2. Spreads and `ref` in component inlining

Status: steps 1 and 2 are done. Step 3 is not planned. See below.

See [inline-spread-plan.md](inline-spread-plan.md). In short:

- Done. `<div {...props} />` inside a component blocked the component everywhere. It now becomes the attributes and children the call site passes, like a spread of a view.
- Done. `ref` at a call site blocked it. It now moves to the element when the component only forwards `props.ref`.
- Not planned. A spread of an unknown object at a call site blocks it. No app has a case worth the work:
  - The demo and Hacker News have no spread at a call site.
  - solid-ui has 94 spreads onto a component. 78 are `<Icon {...props}>` in icon wrappers, which spread their own props and inline already. Most of the rest are Kobalte primitives, which are member tags from a package.
  - The copy would need Solid's `mergeProps` helper. In chunk mode the passes do not know its name in the chunk.

## 3. Memos whose computation is a constant

Status: done. Neither app has such a memo, so their sizes do not change.

`createMemo(() => 1 + 2)` folded to `createMemo(() => 3)` and stayed a memo. A computation that folds to a literal reads no signals, so its value never changes.

Plan:

1. In `memo.ts`, accept a memo whose computation returns a literal after folding, or a binding that never changes and holds one.
2. Replace every read `m()` with the literal, however many reads there are. Drop the declaration.
3. Keep the same rules for what else may reference the memo. A memo passed as a value stays. So does one called before its declaration, since that call throws today.

This shifts the hydration keys after the memo, which is already an accepted difference of memo inlining.

## 4. `<Dynamic>` with a known component

Status: done. Neither app uses `<Dynamic>`, so their sizes do not change.

Solid 2's `<Dynamic>` is `createComponent(dynamic(() => props.component), omit(props, 'component'))`. For a component that never changes, its memos always hold that component, and it renders it untracked with the other props. That is what `<Card>` does. An import is left out, since it could hold a tag name string or a server component binding.

`<Dynamic component="h1">` already became `<h1>`. `<Dynamic component={Title}>` stayed, even when `Title` was a top-level component that is never reassigned.

Plan:

1. In `fold.ts`, rewrite `<Dynamic component={X} ...>` to `<X ...>` when `X` is a top-level binding that is never reassigned, or an import, with a capitalized name.
2. The inline pass then treats it like any other call.
3. List the accepted difference in `strategy.md`. `<Dynamic>` creates a memo for the component, so removing it shifts the hydration keys after it.

## 5. The `children()` helper read once

Status: done for children that are JSX. Neither app uses the helper, so their sizes do not change.

Solid 2's `children(fn)` is a lazy memo of `fn`, and a second lazy memo that flattens its result. `insert` flattens a child the same way. JSX reads nothing at the top when it is created, since its dynamic parts run in their own effects, so neither memo runs again. Children that are not JSX, like `props.children` left as it is, can be functions or arrays the helper calls inside its memo, so they keep it.

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

Status: done, in the fold pass. Neither app calls a render prop with constants, so their sizes do not change.

A `ref` or a spread in the JSX also keeps the call. A `ref` runs while the JSX is made, inside the effect that inserts it, so it could track what it reads. A spread reads its object there too.

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

## 7. `<For>` over a constant list

Status: done. The demo's `About` and `Chart` pages unroll their `FEATURES` and `POINTS` lists, which saves about 118 B gzipped. Hacker News has no constant list.

The size estimate also counted a literal child like `{'a'}` as an insert. Solid's JSX transform writes it into the template as text, so the estimate now does too. On its own that change made the demo 11 B larger, from one inlining decision it now makes differently. With unrolling, the default build is 107 B smaller than before.

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
2. Use the size estimate. Unrolling a long list can be larger than the loop.
3. List the accepted difference. `<For>` gives each item its own owner, so unrolling shifts the hydration keys.

`.map()` over a constant list is left out. Solid code renders lists with `<For>`, since `.map()` makes every row again when the list changes.

## 8. Constants in hydrating builds

Status: done.

Hydrating builds and server builds always run in module mode. Constants exported from a module with JSX did not fold there. `define` and `import.meta.env` did not fold either.

Plan:

1. Done. Constants from a module with JSX are read through the loaders that copying uses, in both modes. Two changes were needed. The module mode check now follows imports through modules without JSX too, since a constant can be read through one. And a constant read in progress is no longer shared between reads, which made two reads wait for each other.
2. Done. `define` and `import.meta.env` values are read from the resolved Vite config and passed to `compile` as `globalConstants`. A `declare const` used to bind its name, which stopped a global from folding. It no longer does.
3. Done. A `define` entry only folds when every environment in the config gives it the same primitive, and `import.meta.env.SSR` never folds. Two separate `vite build` runs with different `define` options are not detected, since each sees only its own config.

## 9. Copying components from chosen packages

Status: done. `optimizer.packages` lists the packages to copy from. Re-exports and aliases are followed, and the copies inline wherever they can be, since the estimate cannot see what a package's other modules and the runtime code only they use add up to. The `vendor` build of `examples/kobalte` drops from 18.40 kB to 13.32 kB gzipped, and module mode inlines Kobalte too.

The `vendor` build stays about 1 kB above `single`. Most of it is Rolldown, not the optimizer: `claimElement` only works once a router registers a claim handler. In one chunk, Rolldown sees that nothing registers one, and drops the calls and the claim, snapshot, and lane code they reach. Across chunks it keeps them, since the vendor chunk exports `claimElement` to the app chunk. The plain build shows the same, by 0.22 kB.

Components from `node_modules` are never copied across modules.

What a spike on Solid 2 libraries found, on 2026-11-06:

- `@kobalte/core` 2.0.0-alpha.4 and `@tanstack/solid-router` 2.0.0-rc.10 publish their JSX through the `solid` condition. `@solidjs/router` 2 has no `<A>` left to copy.
- Built as one chunk, where nothing needs a copy, none of their components inlined. A copy would not have changed that.
- Kobalte's components were blocked by the inline pass itself: each export is an alias like `const Button = ButtonRoot`, each root renders `<Polymorphic as="button" ref={[setRef, untrack(() => merged.ref)]} {...others} />`, and `Polymorphic` renders `<Dynamic {...others} component={props.as} />`. These now inline. See `examples/kobalte`.
- TanStack's `Link` has several `return`s and passes its props to `splitProps` and `useLinkProps`, so it stays.

This was item 8. It moved below constants in hydrating builds, since copying adds less than it seemed:

- Copying exists because Rolldown splits chunks before `renderChunk`, and module mode has no chunk step. A copy made in `transform` lets the bundler drop the original and what only it used. Rolldown has no hook between building the module graph and splitting chunks that could do this instead.
- Library code in the same chunk as its user already inlines in `renderChunk`, without a copy. That is where Hacker News's 2.2% in the `vendor` build comes from.
- A copy only adds something when the library lands in another chunk than its user, or in module mode. The only measured case is the router's own components, whose subtrees call code that is not visible, so most of them would stay anyway. Headless libraries like Kobalte are where context inlining would help most.

Plan:

1. Check which Solid libraries publish their JSX source through the `solid` export condition. A package that only publishes lowered code cannot be copied.
2. Add `optimizer.packages`, a list of package names to copy from. Do not turn it on for every package by default.
3. In `copyImported` and the usage index in `vite/index.ts`, let resolved ids from those packages through.
4. Treat every export of a package as used elsewhere. A package's exports are its public API, and other packages can import them too.
5. Add no `__so_local$` exports to package modules. Copy a component only when everything it needs is exported or imported already.
6. Build solid-ui with `@kobalte/core` listed, and compare with the current numbers.

## 10. Class instances as context values

A store as a context value already works, and so does a `[state, setState]` pair the consumer destructures.

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

Status: done for chunk mode. In `renderChunk`, each chunk is also built with `alwaysInline`, and the smaller one, minified and gzipped, is kept. `examples/kobalte` drops from 18.20 kB to 12.28 kB gzipped in the `default` and `single` builds, and the demo and Hacker News do not change. Module mode and a runtime in another chunk, like the `vendor` build, are not covered.

`examples/kobalte` saves 4.3% with the estimate, and 34% with `alwaysInline` (19.01 kB to 12.57 kB gzipped, one chunk). Its three `Button`s and two `Link`s stay calls, since each copy repeats Kobalte's signal, `createTagName`, and three memos. Inlining all of them leaves no `<Dynamic>`, `merge()`, or `omit()` in the app, and those runtime parts are most of the difference. A per-component credit cannot see that.

What the demo showed, comparing the default build with one that sets `alwaysInline`:

- `alwaysInline` was 762, 695, and 502 B smaller in the three chunkings. On Hacker News it was 70 to 80 B larger, so the estimate is right there.
- The difference was `Table`. Inlining it into both pages lets its `<For>` over the pages' constant lists unroll, and each row's `Badge` gets a constant `tone`. Its `class` then turns static, and nothing in the app needs `className`, `classListToObject`, or `flattenClassList`. Those helpers and `Table` are about 714 B gzipped.

Two things kept the estimate from seeing it:

1. Local. A copy was measured without the constants its call site passes by name, like `rows={ROWS}`. Done: the code a copy is measured in now holds the module's top-level constants of literals, so the copy folds and unrolls as it will once inlined. This alone made `Table` and `Card` inline, and the demo's default build 762 B smaller, to −32.1%.
2. Whole-program. The helpers only go because every `Badge` in the app turns static. A credit per component cannot know that, and `Badge.tsx` as written still needs `className`. Knowing it means simulating every module's helper needs inside one module's transform, until nothing changes. That costs build time, is hard to reason about, and has to decide the same way in the server and client builds. Not planned unless an app shows a case the local fix does not catch.

The earlier notes:

The estimate does not count runtime helpers that the bundle drops once their last use is gone. In the demo, inlining `Tab` drops `merge`, `omit`, `spread`, and `useContext`, worth several kilobytes. That only happened because `Tab` was worth inlining for its own sake.

This needs research before a plan:

- The dry run in `inject.ts` already knows which helpers each function needs.
- A helper only leaves the bundle when no module in any chunk uses it. Knowing that needs a build-wide record of helper users, built the same way in every build.
- Module mode must not let this record depend on the transform order, or hydration breaks.

Start with a prototype that only works in chunk mode. Measure it on solid-ui, where most wrappers are declined today.

## 12. Measure runtime and hydration, not only bundle size

Status: started. `benchmarks/runtime` measures three apps in client, server, and hydrating builds: the demo with every page at once ([results](benchmarks/runtime/results.md)), Hacker News's story lists and comments from its fixtures ([results](benchmarks/runtime/results-hackernews.md)), and the tracker example ([results](benchmarks/runtime/results-tracker.md)). Owner and computation counts, and updates after mount, are open.

On Hacker News, nearly all of the runtime change comes from item 21. With `conditionals: false`, the warm client render is 3% faster than the plain build and the heap 0.2% smaller. With it, they are 22% and 29% smaller, and `renderToString` is 37% faster.

Every number so far is gzip size or build time. Template merging, component inlining, provider removal and memo inlining also change what runs. They create fewer templates and components, fewer owners and computations, fewer DOM marker comments, and in hydrating builds fewer hydration keys and markers in the server's HTML. Nothing measures that yet. `report.ts` counts templates and component calls in the output code, and `scripts/bench.ts` measures only size and build time.

Plan:

1. Counts, plain against optimized. They are exact, so any difference is real.
   - Client render: templates created and cloned, component calls, owners and computations alive after mount, and DOM nodes, with `<!>` marker comments counted on their own.
   - Server render and hydration: SSR HTML bytes, hydration key attributes and marker comments in the HTML, and nodes the client claims while hydrating.
2. Timings, in Chromium through Playwright. Each result needs repeated runs and has to clear the noise, measured as the perf-pass skill's `bench.py` does.
   - Client: time to first render, mount and unmount loops, heap after mount.
   - Server and hydration: `renderToString` throughput and client hydration time.
3. Apps: the demo, Hacker News, and the tracker. The benchmark renders each on the server and hydrates it, so no separate hydrating example is needed.

Start with the client counts in step 1. They need only a small counting harness, and they show whether the runtime effect is large enough to justify the timings and the SSR app. Updates after mount, such as a signal write reaching the DOM, are left out at first: merging changes creation more than updates, and update benchmarks need a script per app.

## Items that bundlers cannot do

Items 13 to 20 come from a brainstorm on 2026-11-06. Item 21 came from checking them against Hacker News. Each one needs to know what a Solid call does, which a bundler or minifier does not. None is measured yet. Run step 0's report and the size script on the demo, Hacker News, and `examples/kobalte` before each plan starts.

Suggested order:

1. Item 13, since it is small and every fold leaves more for it to remove.
2. Items 14 and 15, which reuse `memo.ts` and make each other fold more.
3. Item 16, then item 17. These matter most for apps built on a component library.
4. Items 18, 19, and 20, which depend on the build kind or on item 12's runtime numbers.

## 13. Mark Solid's factory calls as free of side effects

Status: done. The fold pass marks `lazy` and `createContext`, and `createSignal` and `createStore` whose first argument is a literal, an object, or an array. In rc.21 those create a node with no owner and no hydration id. `createMemo`, and either call given a function, create a computation that runs at once, so they stay unmarked. Rolldown drops an unused marked call at module scope, even when destructured. Inside a function, its minifier drops `const s = createSignal(0)` but keeps `const [a, b] = createSignal(0)`. On the demo, Hacker News, Kobalte, and the tracker, sizes change by 5 B or less gzipped.

Solid 2.0.0-rc.21's `solid.js` has three `__PURE__` annotations, all on its own internal values. `createContext`, `createSignal`, `createMemo`, and `lazy` have none. A bundler keeps a call it cannot prove free of side effects, even when nothing reads its result.

The optimizer's own folding leaves such calls behind:

```jsx
const ThemeCtx = createContext('light');
const Settings = lazy(() => import('./Settings'));

// Every reader of ThemeCtx inlined, and the only <Settings> sat in a branch that folded away.
```

Both declarations stay in the bundle, and the kept `lazy` keeps the `./Settings` chunk.

Plan:

1. Check which Solid 2 factories are safe to drop when their result is unused. `createContext` and `lazy` only build values. `createSignal` and `createMemo` at module scope create nodes with no owner. Check that dropping them changes nothing else, such as a dev warning or the hydration keys.
2. After the last pass, add `/*@__PURE__*/` to each such call whose result is unused or only declared.
3. In chunk mode the passes already know which chunk bindings are Solid's built-ins and `createMemo`. Record the other factories the same way.
4. Measure the demo and Hacker News. Neither may have a case, so add a test fixture where folding leaves a `lazy` with no reader.

## 14. Signals that are never written

Status: done for signals. None of the apps has a signal that nothing writes, so their sizes do not change. A store that nothing writes is open: a read of a nested object returns a proxy, so only primitive properties could fold, and none of the apps has such a store.

`const [count] = createSignal(5)` has no setter, so `count()` always returns `5`. A bundler cannot see this, since `createSignal` is a call into the runtime.

Plan:

1. In `memo.ts`, accept `createSignal(literal)` when the setter is not destructured, or is a binding nothing references.
2. Also accept `createSignal(literal)` without options. An `equals` option does not matter when no write happens.
3. Replace every read `count()` with the literal, and drop the declaration. Use the same rules as item 3 for other references to the getter: a getter passed as a value stays.
4. Apply the same rule to `createStore(objectLiteral)` with no setter. A store read returns the same value every time when nothing writes to it. The store's object can hold functions or getters, so start with literals of primitives only.
5. List the accepted difference in `strategy.md`. The signal no longer exists, which shifts the hydration keys after it if Solid gives signals a slot. Check that first.

## 15. Derived accessors that are plain arrows

Status: done. With more than one call, the body is copied when `(calls - 1) × body ≤ 3 × calls + 13`, in minified characters. In chunk mode it also applies to library code: Hacker News's router has two such arrows, and its vendor chunk is 26 B smaller gzipped.

`const double = () => count() * 2` read once in JSX can be replaced by its body. Memo inlining does this for `createMemo`. A plain arrow needs fewer rules, since it has no cache and no owner, and every call already runs its body again.

```jsx
const label = () => (props.open ? 'Close' : 'Open');
return <button>{label()}</button>;
```

After inlining, the arrow becomes `<button>{props.open ? 'Close' : 'Open'}</button>`. With a constant `open` from the call site, the text joins the template.

Plan:

1. Accept a top-level or component-level `const` that holds an arrow with no parameters, whose body is one expression.
2. Replace each call `label()` with the body, when the body only reads bindings that are in scope at the call and never reassigned.
3. Allow more than one call when the body folds to a literal or is short, since the copy costs the same as the call. Use the size estimate otherwise.
4. Leave the arrow alone when it is referenced other than by a call, such as `insert(el, label)` or `on:click={label}`.

## 16. Class helpers evaluated at build time

Component libraries build `class` with helpers like `clsx`, `cn` (`twMerge(clsx(...))`), and `cva`. A bundler treats each call as opaque. After component inlining, the arguments are often constants:

```jsx
// A copy of solid-ui's Button, inlined with variant="outline" and size="sm"
<button class={cn(buttonVariants({ variant: 'outline', size: 'sm' }), undefined)} />
```

The call could become a string at build time. The `class` then turns static, joins the template, and needs no effect or `className` helper. `strategy.md` says solid-ui's wrappers stay calls because each copy repeats its `cn(...)` call and class string. A static string is one attribute in a template.

Plan:

1. Add an option `pureFunctions`, a list of package exports that return the same result for the same arguments and have no side effects, such as `{ clsx: ['clsx', 'default'], 'tailwind-merge': ['twMerge'] }`.
2. In the fold pass, call such a function at build time when every argument folds to a constant. Load the package in the build process, not in the bundle, and replace the call with the result when it is a string, number, or boolean.
3. Follow a local wrapper like `function cn(...inputs) { return twMerge(clsx(inputs)); }` when its body only calls listed functions on its parameters.
4. Handle `cva` as a listed function that returns a function. Fold `buttonVariants({ ... })` when the `cva(...)` call's arguments are constants too.
5. Measure on solid-ui with `@kobalte/core` in `optimizer.packages`. Count how many `class` attributes turn static.

Risks:

- Running package code during the build runs whatever it does on import. Only listed packages run, and they run in the build process.
- The server build and the client build must give the same result. They do, since both run the same function on the same constants.

## 17. Constant props baked into a component every caller agrees on

When every call of a component passes the same constant for a prop, the component can fold that prop inside itself, and the calls can stop passing it:

```jsx
<Button variant="primary">Save</Button>
<Button variant="primary">Send</Button>
// Button folds props.variant to 'primary'. Its other variants, and their entries in a cva table, go away.
```

This applies to components that stay calls because of the size estimate. A bundler cannot do this, since props are an object of getters.

The same pass drops props the component never reads, and the getters the call sites create for them.

Plan:

1. Chunk mode only at first. A chunk holds every call of a component when the component is not exported from it.
2. Collect each call's attributes. A prop qualifies when every call passes the same constant, no call spreads, and the component is used in no other way, such as passed as a value.
3. Rewrite `props.name` inside the component to the constant, then fold. Remove the attribute from every call.
4. For a prop the component never reads, remove the attribute from every call when its value has no side effects.
5. Module mode needs every call in the project. The usage index in `vite/index.ts` records which modules use each export. It would also have to record the constant attributes at each call. Both builds read the same files, so they would decide the same way. Plan that part only after chunk mode shows a gain.

This is whole-program in module mode, which item 11 avoided. Keep it to chunk mode unless a measured app needs more.

## 18. `isServer` in builds that do not hydrate

A client build that does not hydrate always has `isServer === false` and `import.meta.env.SSR === false`. Folding them removes the server branches before Solid's JSX transform runs, so templates can merge. The bundler's own constant folding happens after the JSX is lowered, too late for that.

Plan:

1. In chunk mode, which only runs for client builds that do not hydrate, pass `isServer` from `@solidjs/web` as a constant `false`, and `import.meta.env.SSR` as `false` in `globalConstants`.
2. Hydrating builds keep both unfolded for now. A fold that removes a `<Show>` removes it in both builds, whichever branch stays, so the owner tree may still match. Check each fold rule before turning it on there.

## 19. Client-only code in server builds

In a server build, `onMount`, `createEffect` bodies, `ref` callbacks, and `on*` handlers never run. Their imports stay in the server bundle, such as a chart library loaded inside `onMount`. A bundler cannot know these callbacks never run.

Plan:

1. Read what Solid's SSR transform already drops from `ref` and `on*` attributes in 2.0.0-rc.21.
2. In a server build, replace the callback given to `onMount`, the effect function of `createEffect`, and the remaining `ref` and `on*` values with `() => {}`. The bundler then drops imports only those callbacks used.
3. Keep `createEffect`'s compute function when it could throw or read a value that suspends, since the server may run it. Check Solid 2's server `createEffect` first.
4. Measure the server bundle of a hydrating example, once item 12 adds one.

## 20. Handlers hoisted out of `<For>` rows

`onClick={() => setSelected(null)}` in a `<For>` callback creates a new function for each row. When the function only reads module-level bindings, or bindings of the component around the `<For>`, it can move out of the callback and be created once.

Plan:

1. Hoist an arrow given to an `on*` attribute when every binding it reads is declared outside the `<For>` callback.
2. Hoist to the nearest scope that declares all of them. A module-level target needs no `const` in a component.
3. The bundle does not get smaller. Measure with item 12's runtime benchmark, mount time and heap for a list of 1,000 rows, before keeping it.

## 21. `<Show>` and `<Switch>` lowered to ternaries

Status: done. `<Show>` in #43. `<Switch>` followed, since the demo's two were the last users of `Switch`, `Match`, and `children()`, and its builds are 270 to 290 B smaller gzipped without them.

Items 13 to 20 were checked against Hacker News on 2026-11-06, and none applies to it:

- No factory call is left unused after folding, no signal goes unwritten, and no class helper is used.
- Its `class={{ toggle: true, open: open() }}` already compiles to a static class and one `classList.toggle`.
- Its handlers read a signal of the component around them, and it has no server build.

What it does have is 14 `<Show>`s, most of them in `Story` and `Comment`, which render once per story and per comment. Solid 2's `<Show>` is a component call and three memos. Without a callback child or `keyed`, it does what `{when ? children : fallback}` compiles to: one memo of `!!when`, and a function `insert` runs.

Rewriting every `<Show>` in the app by hand, counted in the `single` build with the fixtures:

| Route          | Component calls | Computations |
| -------------- | --------------- | ------------ |
| `/`            | 106 → 13        | 402 → 186    |
| `/stories/:id` | 31 → 21         | 69 → 53      |
| `/users/:id`   | 15 → 12         | 42 → 37      |

Each route rendered the same DOM. Size changed by 30 B or less gzipped, since the router keeps `<Show>` in the runtime.

Plan:

1. Lower a `<Show>` whose props are only `when` and `fallback` and whose children are not a callback, after the other passes stop changing the code.
2. Write `{when ? children : fallback}` in an element or a fragment, and `<>{…}</>` as a component's sole child or outside JSX. A bare ternary as a component's child compiles to a getter with no memo.
3. List the accepted difference in `strategy.md`. Removing `<Show>` shifts the hydration keys after it.
4. Measure timings once item 12 has a Hacker News harness. The demo has one `<Show>`.

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
- **Adjacent text children joined into one effect.** `{a()} - {b()}` takes two `insert` calls and their markers. One text effect would do, but only when both values are known to be strings or numbers, which needs type information.
- **A spread of an unknown object at a component call.** No app has a case. See item 2.
- **Components with statements in a `<Show>` child or a `fallback`.** About 16 B minified per call. See item 1.
