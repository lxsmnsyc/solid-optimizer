---
title: Set up the Vite plugin
description: Replace @solidjs/vite-plugin with solid-optimizer/vite, then turn passes off, optimize while serving, or force module mode.
type: guide
---

`solid-optimizer/vite` takes the same options as `@solidjs/vite-plugin`, plus `optimizer`.

```ts title="vite.config.ts"
import { defineConfig } from 'vite';
import solid from 'solid-optimizer/vite';

export default defineConfig({
  plugins: [
    solid({
      ssr: true,
      optimizer: {
        // Leave context providers in place.
        contexts: false,
        // Print what stays as written in each build, and why.
        report: true,
      },
    }),
  ],
});
```

## Steps

1. Replace the plugin. Change the import from `@solidjs/vite-plugin` to `solid-optimizer/vite`. The plugin wraps the official one, so SSR, server functions, and HMR keep working.

   ```ts title="vite.config.ts"
   import solid from 'solid-optimizer/vite';
   ```

2. Keep your options. Every option of `@solidjs/vite-plugin` is passed to it. `solid.moduleName`, `solid.builtIns`, and `extensions` also feed the optimizer. See [Vite plugin options](../reference/vite-options.md).

3. Turn passes off when you need to. Each pass has a boolean option, `true` by default.

   ```ts title="vite.config.ts"
   solid({
     optimizer: {
       contexts: false,
       memos: false,
     },
   });
   ```

   To use `@solidjs/vite-plugin` as it is, set `optimizer: false`.

4. Optimize while serving, if you want to. The optimizer is off while serving. Set `optimizer.dev` to run module mode in dev too.

   ```ts title="vite.config.ts"
   solid({ optimizer: { dev: true } });
   ```

5. Force module mode, if you want to. `optimizer.mode` is `'auto'` by default. Set it to `'module'` to never keep JSX through bundling.

   ```ts title="vite.config.ts"
   solid({ optimizer: { mode: 'module' } });
   ```

   Chunk mode is also skipped when the `babel` option is set or `compiler` is `'babel'`. See [Chunk and module mode](../concepts/modes.md).

6. Compile the server and client builds the same way. Use the same `optimizer` options for both. See [Hydration](../concepts/hydration.md).

## Related

- [Vite plugin options](../reference/vite-options.md) for every option, its type and default.
- [Chunk and module mode](../concepts/modes.md) for what `optimizer.mode` picks.
- [Find out why a component stays](report.md) to check what the plugin left alone.
- [Inline components from packages](packages.md) for `optimizer.packages`.
