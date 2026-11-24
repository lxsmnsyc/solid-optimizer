---
title: Use compile without Vite
description: Optimize JSX with compile, lower it with @solidjs/compiler, and fold constants across modules.
type: guide
---

`compile` optimizes one module, or a bundled chunk that kept its JSX. The output is still JSX, so run Solid's JSX transform after it.

```ts
import { transform } from '@solidjs/compiler';
import { compile } from 'solid-optimizer';

const optimized = compile(code, { filename: 'app.tsx' });
const output = transform(optimized.code, {
  filename: 'app.tsx',
  moduleName: '@solidjs/web',
  generate: 'dom',
});
```

## Steps

1. Call `compile` with the code and a `filename`. The file name picks the parser and names the source in the source map.

   ```ts
   import { compile } from 'solid-optimizer';

   const result = compile(code, { filename: 'app.tsx' });

   result.code; // JSX, ready for Solid's JSX transform
   result.map; // a source map, or null when nothing changed
   result.skipped; // what was left alone, when `report` is set
   ```

2. Lower the result with `@solidjs/compiler`, as in the example at the top.

3. Fold constants from other modules, if you want to. Read the constants of the imported module with `readModuleConstants`, then pass them as `importedConstants`, keyed by the import specifier as the code writes it.

   ```ts
   import { compile, readModuleConstants } from 'solid-optimizer';

   const config = readModuleConstants(configCode, { filename: 'config.ts' });
   config.exports; // { SHOW_BANNER: true, THEME: 'light' }
   config.imports; // the modules it imports from

   compile(appCode, {
     filename: 'app.tsx',
     importedConstants: { './config': config.exports },
   });
   ```

   A module that re-exports constants from another module takes that module's constants in its own `importedConstants`.

4. Fold global names, if you want to. `globalConstants` takes values of global names and paths, like a bundler's `define` entries.

   ```ts
   compile(code, {
     filename: 'app.tsx',
     globalConstants: { __DEV__: false, 'import.meta.env.MODE': 'production' },
   });
   ```

5. Ask for a report, if you want to. Set `report: true` and read `result.skipped`. Each entry has a `pass`, a `reason`, and a `name`.

   ```ts
   const result = compile(code, { filename: 'app.tsx', report: true });
   for (const skip of result.skipped ?? []) {
     console.log(skip.pass, skip.reason, skip.name);
   }
   ```

6. Compile a server build and its client build with the same code and options. See [Hydration](../concepts/hydration.md).

The Vite plugin does all of this for you.

## Related

- [compile and readModuleConstants](../reference/compile.md) for every option and type.
- [Constants across modules](../concepts/cross-module.md) for what folds.
- [Report reasons](../reference/reasons.md) for the reason codes in `skipped`.
- [Set up the Vite plugin](vite-plugin.md) to let the plugin do this.
