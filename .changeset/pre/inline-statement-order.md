---
"solid-optimizer": patch
---

Keep a component as a call when its statements assign to something declared outside it, like a counter at the top of the module. A copy's statements run before the JSX around the call, so JSX that read the value saw every copy's write at once. `optimizer.report` gives these calls the reason `component-write`.
