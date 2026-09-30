---
"solid-optimizer": minor
---

Fold constants imported from other modules. `compile` takes them in `importedConstants`, and `readModuleConstants` reads them from a module. `solid-optimizer/vite` reads them from the modules each module imports, so a branch they fold away is gone before bundling, along with the built-ins and `lazy()` chunks only it used.
