---
'solid-optimizer': patch
---

The source map now points each copied character at the character it copies. Inlined JSX maps to the component's own JSX, a hoisted statement maps to where the component declares it, and a prop value maps to the call site's attribute. Before, everything a pass wrote mapped to the start of what it replaced, so an error inside inlined code pointed at the call site. Code a pass writes itself, such as a folded constant or a renamed local, maps to what it replaces.
