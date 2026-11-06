# Runtime benchmark

Measures what the optimizer changes at runtime, not only in bundle size: client creation, server rendering, and hydration. Each app is built once with `@solidjs/vite-plugin` alone and once with the optimizer. Each build is one minified chunk.

| App          | What it renders                                                                                                         | Results                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `demo`       | `examples/demo` with every page at once and none of them lazy (`src/demo`).                                             | [results.md](results.md), read by the website  |
| `hackernews` | Hacker News's two story lists and a story's comments, from its fixtures, without the router (`src/hackernews`).         | [results-hackernews.md](results-hackernews.md) |
| `tracker`    | The tracker example's layout, with its 40 issues read at once instead of loaded, and no issue selected (`src/tracker`). | [results-tracker.md](results-tracker.md)       |

## Run

Build the package first, then the benchmark.

```bash
pnpm --filter solid-optimizer build
pnpm --filter runtime-bench bench
pnpm --filter runtime-bench bench --app hackernews
pnpm --filter runtime-bench bench --app tracker
```

`--app <name>` picks the app, `demo` by default. `--runs <n>` sets the samples per timing, 15 by default. Chromium comes from Playwright: run `pnpm --filter runtime-bench exec playwright install chromium` if it is missing.

## What it measures

Counts are exact, so any difference is real:

- Client render: templates created and cloned, elements, text nodes, and comment markers.
- Server render: HTML bytes, hydration keys (`_hk`), and comment markers.
- Hydration: nodes created and server nodes removed. Both are 0 when hydration claims every node the server wrote.

Timings run the two builds in turns, after 3 warmup samples, so drift in machine load hits both. A change is real when it is larger than 3 times the noise, the larger median absolute deviation of the two sides.

- First client render and hydration each run in a fresh page, so they include compiling the app's code.
- Warm client render and dispose are averaged over 200 mounts in one page.
- Heap is the JavaScript heap 200 mounted copies hold, per copy, read through the DevTools protocol after a full garbage collection.
- `renderToString` runs in a separate Node process per sample, so the two builds do not share JIT state.

Before timing, the benchmark checks that both builds render the same markup, that hydration leaves the server's markup as it was, and that a click after hydration updates the page: the demo's counter, Hacker News's comment toggle, or the tracker's first star.

## Limits

- The demo is written to show the optimizer's passes. Hacker News is a real app, but without its router, whose components the optimizer leaves alone.
- Updates after mount, like a signal write reaching the DOM, are not measured.
- Owners and computations are not counted. The runtime has no public way to list them.
