# Hacker News example

[solidjs/solid-hackernews](https://github.com/solidjs/solid-hackernews), a client-rendered Hacker News reader by Ryan Carniato, built with `solid-optimizer/vite`. It checks the optimizer against an app it was not written for.

The app is the original, with these changes to build it with Vite:

- `src/routes.js` is `src/routes.jsx`, since Vite only reads JSX from `.jsx` and `.tsx` files.
- The router has no `base`, which came from the Rollup build.
- The service worker is left out.
- `@solidjs/router` is `0.10.10` and `solid-js` is `1.9`.

## Build

Build the package first, then the app.

```bash
pnpm --filter solid-optimizer build
pnpm --filter hackernews build
```

This builds the app with and without the optimizer, in three chunking modes, into `dist/<mode>/<optimized|plain>`, and prints a report of the chunk sizes, templates, and components each chunk still calls.

- `default` lets Rolldown split the app.
- `vendor` puts everything from `node_modules` in a `vendor` chunk.
- `single` turns code splitting off.

`pnpm --filter hackernews verify` loads every build in a browser, opens each route, collapses a comment thread, and checks that the optimized app renders the same DOM as the plain one. The Hacker News API is replaced by the responses in `fixtures/`, so every run renders the same stories.

`pnpm --filter hackernews dev` runs the app against the live API.

## What to look for

- `Story` and `Nav` are inlined, including across modules, so no chunk calls them.
- `Comment` renders itself, so it stays a component.
- Most of the markup sits in `<Show>` and `<For>` whose conditions depend on the data, so few templates merge, and the bundles shrink by about 1%. The gains grow with how many components an app nests.
