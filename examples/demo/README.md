# solid-optimizer demo

A Solid 2.0 app built with `solid-optimizer/vite`, for checking how the optimizer handles Rolldown's chunks.

## Build

Build the package first, then the demo.

```bash
pnpm --filter solid-optimizer build
pnpm --filter demo build
```

This builds the app with and without the optimizer, in three chunking modes, into `dist/<mode>/<optimized|plain>`. The output is unminified, so it is easy to read. Then it prints a report.

- `default` lets Rolldown split the app. The runtime gets its own chunk.
- `vendor` puts everything from `node_modules` in a `vendor` chunk.
- `single` turns code splitting off, so the whole app is one chunk.

`pnpm --filter demo report` prints the report again. For each chunk, it shows the minified and gzipped size, the number of templates, and the components the chunk still calls. It fails when a chunk still calls a component it should have inlined.

`pnpm --filter demo verify` loads every build in a browser, opens each page, and checks that the optimized app renders the same DOM as the plain one.

## What to look for

- Every component is inlined before bundling, including into the lazy pages, so no chunk calls `Card`, `Table`, `Avatar`, or `Button` anymore. The `Table` chunk is gone, and in `default` mode the runtime moves into the entry chunk.
- `Banner` folds on `SHOW_BANNER` and `THEME` from `config.ts` before bundling, so no chunk uses `<Dynamic>` or `<Show>`.
- `Tabs` and `Tab` share state through a context, and `Tab` uses `merge` and `omit`. Both inline into `Home`, and the provider is removed, so the runtime keeps no `spread`, `merge`, `omit`, or context code.
- `Home` renders in a `<Switch>` fallback, so it stays a component, with `Counter`, `Card`, and the tabs merged into it.
- The lazy pages grow a little, since each holds its own copy of `Card`.
