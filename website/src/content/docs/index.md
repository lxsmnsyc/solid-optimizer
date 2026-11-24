---
title: Getting started
description: Install solid-optimizer, add it to a Vite project, and see what it leaves as written.
type: tutorial
---

solid-optimizer rewrites JSX before Solid's JSX transform lowers it. It inlines components, removes context providers, inlines memos, and resolves control flow whose outcome is known at build time. More markup lands in fewer templates, so the browser clones fewer of them, the server sends fewer hydration keys, and fewer component calls run.

```ts title="vite.config.ts"
import { defineConfig } from 'vite';
import solid from 'solid-optimizer/vite';

export default defineConfig({
  plugins: [solid({ ssr: true })],
});
```

## Before you start

- A Vite project that builds with `@solidjs/vite-plugin`.
- SolidJS 2.0 and `@solidjs/compiler`. Solid 1.x projects stay on `solid-optimizer@0`.

You can try the optimizer on your own components in the [REPL](/repl/) first.

## Install

Install the package as a development dependency.

```bash
npm i -D solid-optimizer
```

```bash
pnpm add -D solid-optimizer
```

```bash
yarn add -D solid-optimizer
```

`@solidjs/vite-plugin` and `vite` are optional peer dependencies. Only `solid-optimizer/vite` needs them.

## Set up Vite

`solid-optimizer/vite` replaces `@solidjs/vite-plugin`. It takes the same options and wraps the official plugin, so SSR, server functions, and HMR keep working. Change the import and keep the options.

```ts title="vite.config.ts"
import { defineConfig } from 'vite';
import solid from 'solid-optimizer/vite';

export default defineConfig({
  // Replaces @solidjs/vite-plugin, with the same options.
  plugins: [solid({ ssr: true })],
});
```

## Build

Run your usual build. The optimizer runs on builds and is off while serving.

```bash
npx vite build
```

## See what changed

Turn on the report to see what the optimizer left as written, and why.

```ts title="vite.config.ts"
import { defineConfig } from 'vite';
import solid from 'solid-optimizer/vite';

export default defineConfig({
  plugins: [
    solid({
      ssr: true,
      optimizer: {
        // Print what stays as written in each build, and why.
        report: true,
      },
    }),
  ],
});
```

Build again. Each build prints a report like this one:

```text
solid-optimizer: what stays as written in client
  inline   lazy              4  About, Chart, Dashboard, Settings
  inline   copy-no-host      1  Home (./pages/Home)
  inline   no-host           1  Home
```

Each line is a pass, a reason, how many times it happened, and the names it happened to. A component that is not listed was inlined, or never could be. Here `About` and the other `lazy()` components stay components, because a lazy component loads at run time.

## Next steps

- [Set up the Vite plugin](guides/vite-plugin.md) for the options you are likely to change.
- [Find out why a component stays](guides/report.md) when one you expected to inline stays a component.
- [How it works](concepts/how-it-works.md) for the model behind the output.
- [Hydration](concepts/hydration.md) before you ship a server-rendered app.
