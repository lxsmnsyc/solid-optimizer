---
'solid-optimizer': minor
---

Add `optimizer.packages`, a list of packages whose components are copied into the modules that use them, like `['@kobalte/core']`.

- A copy follows re-exports, like a library entry's `export { t as Button } from './button.jsx'`, and aliases, like `const Button = ButtonRoot`.
- Copies from a listed package inline wherever they can be, so the bundler drops the originals and the runtime code only they used, even when the package lands in another chunk. The `vendor` build of `examples/kobalte` drops from 19.00 kB to 13.75 kB gzipped. `compile` takes `alwaysInlineComponents`, the components to inline wherever they can be.
- A listed package that is external in a build, like a server build that leaves it to Node, gets a warning, since its components are not copied there.
- A build does not hang when a listed package imports the app back through a virtual module, like SolidBase does with its theme's layout. Such a copy is skipped as `copy-cycle`. A copied component that imports a virtual module imports it by its specifier, and when the specifier means another module from the importer, the copy is skipped as `copy-virtual`.
