---
'solid-optimizer': patch
---

A pass no longer puts an element where the HTML parser would move it, which made Solid's JSX transform fail with "The HTML provided is malformed". `<p><Box /></p>`, where `Box` returns a `<div>`, used to become `<p><div>…</div></p>` once `Box` was inlined. The same happened when `<Show>`, `<For>`, or `<Dynamic>` resolved to such an element. Each template is now checked the way Solid checks it, by parsing it as HTML, and an element that would move stays in `{}`, inserted at runtime as before.
