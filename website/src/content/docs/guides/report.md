---
title: Find out why a component stays
description: Turn on the report, read each line, and fix the common reasons a component call is not inlined.
type: guide
---

`optimizer.report` lists each component call, provider, and memo the optimizer left alone, grouped by reason. Turn it on when a component you expected to inline stays a component.

```ts title="vite.config.ts"
solid({ optimizer: { report: true } });
```

```text
solid-optimizer: what stays as written in client
  inline   lazy              4  About, Chart, Dashboard, Settings
  inline   copy-no-host      1  Home (./pages/Home)
  inline   no-host           1  Home
```

## Steps

1. Build with `optimizer.report` set to `true`. The plugin prints one report for each build environment, such as `client` and `ssr`.

2. Read a line. Each line is a pass, a reason, how many times it happened, and the names it happened to. The pass is `inline`, `contexts` for the provider pass, or `memos`. A name with a count, such as `Home×3`, was skipped that many times.

3. Look up the reason in [Report reasons](../reference/reasons.md), or use the common ones below.

   | Reason      | What it means                                                                                                       | Fix                                                                                                         |
   | ----------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
   | `props-use` | The component uses its props other than as `props.name`, a spread onto an element, or a `merge()` or `omit()` view. | Read props as `props.name`, or spread them onto an element.                                                 |
   | `no-host`   | The component has statements, and the call is not in JSX that a component or one of Solid's callbacks returns.      | Call the component from a component's returned JSX, or a callback child of `<For>`, `<Show>`, and the like. |
   | `size`      | The copies would be larger than the calls.                                                                          | Leave it. Set `optimizer.alwaysInline` to inline it anyway.                                                 |
   | `imported`  | The tag is an import, not a component declared in the same module or chunk.                                         | For a package, see [Inline components from packages](packages.md).                                          |
   | `copy-*`    | The component is in another module. The copy was not made, or was made but did not inline.                          | Look up the reason after `copy-`, such as `copy-size` or `copy-package`.                                    |

4. Fix the cause in your code, then build again. A reason that you cannot change in your code, such as `lazy`, is not a bug. A `lazy()` component loads at run time.

5. Receive the report as data, if you want to check it in a script. Pass a function instead of `true`. It runs once for each build environment.

   ```ts title="vite.config.ts"
   solid({
     optimizer: {
       report(report) {
         // report.environment is the Vite environment, like 'client' or 'ssr'.
         for (const skip of report.skips) {
           console.log(skip.pass, skip.reason, skip.name);
         }
       },
     },
   });
   ```

A package's own modules are compiled too, but what they leave alone is not reported, since the app cannot change it. The app's calls of a package's components are. In chunk mode, a chunk is reported as a whole, so it also lists the package code bundled into it.

## Related

- [Report reasons](../reference/reasons.md) for every reason code.
- [Component inlining](../concepts/component-inlining.md) for when a component inlines.
- [Inline components from packages](packages.md) for the `copy-*` reasons.
- [strategy.md](https://github.com/lxsmnsyc/solid-optimizer/blob/main/strategy.md) for the exact rules of each pass.
