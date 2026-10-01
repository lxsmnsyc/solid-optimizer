# solid-ui example

Five example pages of [solid-ui](https://github.com/stefan-karger/solid-ui), a port of shadcn/ui built on Kobalte, built with `solid-optimizer/vite`. It checks the optimizer against an app that is mostly library components: thin wrappers around Kobalte, which pass props on with `splitProps`, `mergeProps` and spreads, and share state through context.

The pages and every module they import are copied from `apps/docs/src` at commit `21ba4fa`, under the MIT license in `LICENSE`. The changes are:

- `src/index.tsx` is new. It routes to the five pages with `@solidjs/router` in place of SolidStart.
- `~/` resolves to `src/` through a Vite alias.
- There is no Tailwind, so the pages render unstyled. The class names stay, so the JavaScript is the same.

## Build

Build the package first, then the app.

```bash
pnpm --filter solid-optimizer build
pnpm --filter solid-ui build
```

This builds the app with and without the optimizer, in three chunking modes, into `dist/<mode>/<optimized|plain>`, and prints a report of the chunk sizes, templates, and components each chunk still calls.

- `default` lets Rolldown split the app.
- `vendor` puts everything from `node_modules` in a `vendor` chunk.
- `single` turns code splitting off.

`pnpm --filter solid-ui verify` loads every build in a browser, opens each page, clicks or presses one control on it, and checks that the optimized app renders the same DOM as the plain one.

`pnpm --filter solid-ui dev` runs the app.

## What to look for

- Kobalte ships its JSX source, so the optimizer also inlines inside Kobalte.
- The wrappers, like `Card`, `Button` and `SelectItem`, are used many times, and most of them render a Kobalte component. Each copy would repeat the wrapper's `cn(...)` call and class string without merging into a template, so they stay components. Small components, and those used once, are inlined.
- The bundles shrink by 0.1–1.3%.
