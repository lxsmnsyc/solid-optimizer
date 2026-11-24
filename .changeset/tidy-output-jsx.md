---
'solid-optimizer': minor
---

- The output JSX no longer holds empty `{}` children, strings in braces such as `class={'card'}`, or fragments around one element. Solid's JSX transform lowers it to the same code as before.
- New `tidy` option, on by default, to turn that off.
