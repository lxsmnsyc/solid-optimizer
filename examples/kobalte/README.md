# solid-optimizer with Kobalte

A Solid 2.0 page built with `solid-optimizer/vite` and `@kobalte/core`, for checking how the optimizer handles a headless component library.

## Build

Build the package first, then the app.

```bash
pnpm --filter solid-optimizer build
pnpm --filter kobalte-example build
```

This builds the app with and without the optimizer, in three chunking modes, into `dist/<mode>/<optimized|plain>`, like the demo. See [the demo](../demo/README.md#build).

`pnpm --filter kobalte-example verify` loads every build in a browser, clicks through it, and checks that the optimized app renders the same DOM as the plain one at every step.

Set `REPORT=1` to print what the optimizer leaves alone in each build, and why.

## What to look for

Kobalte publishes its JSX through the `solid` export condition, so the library is optimized with the app. Each component is an alias of a root, like `const Separator = SeparatorRoot`, and each root renders `<Polymorphic as="hr" ref={[setRef, ...]} {...others} />`, which renders `<Dynamic>`.

- `Badge` and both `Separator`s inline into `Toolbar`. Their `Polymorphic` and `<Dynamic>` become a `<span>` and two `<hr>`s in `Toolbar`'s template.
- The three `Button`s and two `Link`s inline too, in the `default` and `single` builds. The estimate turns them down, since each copy repeats Kobalte's signal, `createTagName`, and the button's three memos. The chunk built with every component inlined is smaller, since it no longer needs `<Dynamic>`, `merge()`, or `omit()`, so that one is kept.
- `optimizer.packages` lists `@kobalte/core`, so its components are copied into `main.tsx` before bundling. In the `vendor` build, where Kobalte is in another chunk than `Toolbar`, they still inline, and the bundler drops the originals and `<Dynamic>`.
