# Tracker example

An issue tracker written for this repo, in the style of current Solid 2 apps: async data under `<Loading>`, an `<Errored>` boundary with a retry, and narrowing `<Show>` callbacks. It measures what the optimizer leaves alone in those patterns, which the demo and Hacker News do not use.

The data is made the same way on every run, in `src/data.ts`. `fetchIssues` and `fetchComments` answer on a later microtask, and the first load of issue 13's comments fails.

## Build

Build the package first, then the app.

```bash
pnpm --filter solid-optimizer build
pnpm --filter tracker build
```

This builds the app with and without the optimizer, in three chunking modes, into `dist/<mode>/<optimized|plain>`, and prints a report of the chunk sizes, templates, and components each chunk still calls. See [the demo](../demo/README.md#build).

`pnpm --filter tracker verify` loads every build in a browser and takes 10 steps through the app: filters, selecting issues, switching tabs, starring a row, the failed load of issue 13, and its retry. It checks that the optimized app renders the same DOM as the plain one at every step, and that every step changes the page.

Set `REPORT=1` to print what the optimizer leaves alone in each build, and why.

## What to look for

- `Label`, `Priority`, `FilterBar`, `ErrorBox`, and `IssueRow` inline. `IssueRow` has a signal, so it inlines into the `<For>` callback, and `Priority`'s `<Switch>` becomes a chain of ternaries.
- The `<For>` over `FILTERS` unrolls into three buttons. `FILTERS` is written `as const`, which needs #48.
- The three `<Show>`s with a callback child, like `{(user) => <Avatar user={user()} />}`, become ternaries whose body reads `when` again.
- `Summary` and `IssueDetail` stay components. Each has statements and sits in a `<Loading>`, whose children have no function to hold them (`no-host`).
- `Avatar` stays a component inside the `<Show>` callbacks, where a copy measures larger than the call.
