# solid-optimizer demo

A small Solid 2.0 app built with `solid-optimizer/vite`, for comparing its bundles with those of `@solidjs/vite-plugin` alone.

## Build

Build the package first, then the demo.

```bash
pnpm --filter solid-optimizer build
pnpm --filter demo build
```

This writes two builds, unminified so they are easy to read:

- `dist/optimized` is built with the optimizer.
- `dist/plain` is built with `optimizer: false`.

Set `MINIFY=1` to compare minified sizes instead.

```bash
MINIFY=1 pnpm --filter demo build
```

## What to look for

- `Title`, `Icon`, `Button`, `Counter`, `Card`, `Home`, and `Banner` are merged into `App`, so the home page is one template.
- `Counter`'s signal moves into `App`.
- `Banner` folds away. `SHOW_BANNER` and `THEME` are constants, so `<Show>`, `<Switch>`, and `<Dynamic>` leave only `<aside class=banner><em>light theme</em></aside>`, and their runtime code is left out of the bundle.
- `About` is loaded with `lazy()`, so it is its own chunk. `Card` stays a component there, since it lives in another chunk.
