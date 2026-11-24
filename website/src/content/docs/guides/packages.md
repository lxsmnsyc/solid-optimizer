---
title: Inline components from packages
description: List a package in optimizer.packages so its components are copied into your modules and inline there.
type: guide
---

`optimizer.packages` lists packages whose components are copied into the modules that use them. Their copies inline wherever they can be, so the bundler drops the originals, even when the package lands in another chunk.

```ts title="vite.config.ts"
solid({
  ssr: true,
  optimizer: {
    packages: ['@kobalte/core'],
  },
});
```

## Steps

1. Check that the package publishes its JSX. Most Solid libraries do through the `solid` export condition. A package that does not publish JSX has none to copy.

2. Add the package to the list.

   ```ts title="vite.config.ts"
   solid({ optimizer: { packages: ['@kobalte/core'] } });
   ```

   Re-exports and aliases like `const Button = ButtonRoot` are followed.

3. Bundle the package in every build. A listed package has to be bundled in the server build and the client build, or the two builds copy different components. For a server build that leaves dependencies to Node, add the package to `ssr.noExternal`.

   ```ts title="vite.config.ts"
   export default defineConfig({
     ssr: { noExternal: ['@kobalte/core'] },
     plugins: [solid({ ssr: true, optimizer: { packages: ['@kobalte/core'] } })],
   });
   ```

   The plugin warns once when a listed package is external in a build. See [Errors](../reference/errors.md).

4. Build with `optimizer.report` on, and read the `copy-*` reasons.

   | Reason                                   | Cause                                                                              |
   | ---------------------------------------- | ---------------------------------------------------------------------------------- |
   | `copy-external`, `copy-package`          | The module is external to the bundle, or in a package the list does not name.      |
   | `copy-not-jsx`                           | The module is not one the official plugin lowers.                                  |
   | `copy-cycle`                             | The component's module imports the importer back.                                  |
   | `copy-shape`                             | The export is not a component the inline pass can read.                            |
   | `copy-wrapper`                           | The component only returns a call of another component in its module.              |
   | `copy-size`, `copy-no-host`, `copy-left` | The copy was made but did not inline. The part after `copy-` is the inline reason. |

   See [Report reasons](../reference/reasons.md) for the full list.

Components from dependencies in `node_modules` are only copied from the packages this option lists. Copies of listed components inline whatever the size estimate says, since the estimate cannot see the runtime code that only they use.

## Related

- [Vite plugin options](../reference/vite-options.md#optimizer-packages) for the option.
- [Find out why a component stays](report.md) to read the report.
- [Hydration](../concepts/hydration.md) for why both builds must copy the same components.
- [Chunk and module mode](../concepts/modes.md) for how copies land in chunks.
