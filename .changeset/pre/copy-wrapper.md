---
"solid-optimizer": patch
---

Stop copying a component into another module when it only returns a call of a component from its own module, like an icon that wraps `<Icon>`. The copy saved nothing at the call site, and moving its markup out of its module made both compress worse.
