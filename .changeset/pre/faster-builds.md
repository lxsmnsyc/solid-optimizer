---
"solid-optimizer": patch
---

Build faster. The parser hands over its AST through shared memory, a pass that changes nothing no longer makes the next one parse again, and source maps are only made when the build writes them.
