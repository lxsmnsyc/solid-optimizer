---
'solid-optimizer': minor
---

Build faster and map code exactly. The parser hands over its AST through shared memory, a pass that changes nothing no longer makes the next one parse again, and source maps are only made when the build writes them. The source map points each copied character at the character it copies: inlined JSX maps to the component's own JSX, a hoisted statement maps to where the component declares it, and a prop value maps to the call site's attribute.
