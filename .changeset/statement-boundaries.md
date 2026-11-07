---
"solid-optimizer": patch
---

Keep statements without a semicolon apart. A pass can replace a read with text that starts with a parenthesis or a template literal, like `(p.close)()` for `props.close()`, which then continued the statement on the line before and called what it returned. Each statement that relies on a line break now ends with a semicolon before the passes run. A module that has nothing else to optimize stays as it was.
