---
"solid-optimizer": patch
---

Stop loading a module to read its constants when the importing module only uses its bindings as types, like `import { Config } from './config'` used in `const config: Config`. TypeScript drops such an import, so the module may be build-time only. Loading it brought its imports into the build, which failed on imports that do not resolve for the app's target and logged warnings for `node:` modules.
