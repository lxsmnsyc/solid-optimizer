---
"solid-optimizer": minor
---

Inline a component only where its copies are no larger than the calls and declaration they replace, so the optimized output is never larger than the plain one because of inlining. The Vite plugin counts which modules use each export, so a component copied from another module only counts its declaration when the importer is its only user. `alwaysInline` restores inlining every component that can be.
