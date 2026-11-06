---
"solid-optimizer": minor
---

Remove context providers whose readers are all visible, and give each `useContext` read the provider's value. Compound components like tabs and accordions now merge into one template. Set `contexts: false` to turn it off.
