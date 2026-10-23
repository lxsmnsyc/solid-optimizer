---
"solid-optimizer": patch
---

Build faster. The parser hands over its AST through shared memory, a pass that changes nothing no longer makes the next one parse again, source maps are only made when the build writes them, and the helpers a module needs are read without printing its lowered code. The solid-ui example builds in about 3.6 s instead of 8 to 24 s.
