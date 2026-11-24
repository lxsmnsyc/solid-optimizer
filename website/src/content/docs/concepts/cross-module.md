---
title: Constants across modules
description: Both modes fold constants imported from other modules in the project, and define and import.meta.env values.
type: concept
---

A constant that another module exports folds in the modules that import it. Here a flag in `config.ts` removes a banner, and the bundler leaves `Banner` out.

```tsx compare="input"
// config.ts
export const SHOW_BANNER = false;

// App.tsx
import { Show } from 'solid-js';
import { SHOW_BANNER } from './config';
import { Banner } from './Banner';

export function App() {
  return (
    <main>
      <Show when={SHOW_BANNER}>
        <Banner />
      </Show>
      <h1>Home</h1>
    </main>
  );
}
```

```tsx compare="output"
// App.tsx
import { Show } from 'solid-js';
import { SHOW_BANNER } from './config';
import { Banner } from './Banner';

export function App() {
  return (
    <main>
      <h1>Home</h1>
    </main>
  );
}

// Nothing uses Banner now, so the
// bundler leaves it out.
```

## Rules

Both modes fold constants imported from other modules in the project.

- Each import is resolved and loaded by the bundler, so aliases, virtual modules, and plugins that rewrite the module are respected.
- A module with JSX is read from this plugin's own output for it.
- A module is skipped when it imports the importer, directly or through other modules of the project, since the two transforms would wait for each other.
- `define` entries and `import.meta.env` values fold in both modes, when every build environment gives them the same primitive value.
- `import.meta.env.SSR` never folds, since the server and client builds differ on it.
- Dependencies are not read.
- Nothing is read while serving.

## Without the plugin

`readModuleConstants` and the `importedConstants` and `globalConstants` options of `compile` do the same by hand. See [Use compile without Vite](../guides/compile-api.md).

## Related

- [Folding and control flow](folding.md) for what happens once a value is a constant.
- [compile and readModuleConstants](../reference/compile.md#read-module-constants) for what counts as a constant export.
- [Chunk and module mode](modes.md) for the two modes.
