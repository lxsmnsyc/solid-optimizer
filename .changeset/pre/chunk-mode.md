---
'solid-optimizer': minor
---

Optimize code-split builds as well as single-chunk ones.

- In chunk mode, components imported from other modules inline before bundling. The bundler then drops them and the runtime code only they used.
- Each chunk is built with every component inlined that can be too, and the smaller of the two is kept, minified and gzipped. `examples/kobalte` drops from 18.20 kB to 12.28 kB gzipped.
- The members that JSX tags like `<Button.Root>` read from a namespace import are imported by name, so the bundle does not build a namespace object for them.
- A `ref` that names a variable, like `let el; <input ref={el} />`, keeps working in client builds that keep JSX through bundling. A chunk is still optimized when a component inlined there turns a spread into attributes that no module in the chunk used. Parentheses that Rolldown drops from `{(a, b)}` are put back.
- The server entry a plugin generates, like the one `@solidjs/vite-plugin` generates with `start`, is read through its virtual module, so the server build inlines as many components as the client build and hydration meets the same markup.
