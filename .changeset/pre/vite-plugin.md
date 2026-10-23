---
"solid-optimizer": minor
---

Add `solid-optimizer/vite`, which replaces `@solidjs/vite-plugin` and takes the same options.
Client builds that do not hydrate optimize each bundled chunk as a whole, so components inline across modules in the same chunk.
Other builds optimize each module before Solid's JSX transform.
