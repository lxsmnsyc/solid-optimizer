---
'solid-optimizer': patch
---

A build no longer hangs when a package listed in `optimizer.packages` imports the app back through a virtual module. SolidBase does this with its theme's layout. The check that keeps two copies from waiting for each other now follows imports through listed packages and virtual modules. Such a copy is skipped as `copy-cycle`. It also leaves out imports only used as types, which TypeScript drops, and Node's built-ins.

A copied component that imports a virtual module now imports it by its specifier, since the virtual module's id cannot be imported again. When the specifier means another module from the importer, the copy is skipped as `copy-virtual`.
