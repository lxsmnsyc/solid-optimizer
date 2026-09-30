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

- `NavLink`, `Banner`, `Icon`, and `Counter` only appear in the entry chunk, so they inline there.
- `Stat` only appears in the dashboard chunk, and `Legend` only in the chart chunk, so they inline there.
- `Badge` only appears in `Table`, so it inlines in the chunk `Table` shares with the dashboard and settings pages.
- `Card`, `Button`, and `Avatar` live in the entry chunk. The lazy pages keep calling them.
- `Table` lives in a shared chunk, so the dashboard and settings pages keep calling it.
- `Home` renders in a `<Switch>` fallback, so it stays a component, with `Counter` merged into it.
- In `single` mode, every component is in one chunk, so all of them inline, and the runtime code only they needed is dropped.
