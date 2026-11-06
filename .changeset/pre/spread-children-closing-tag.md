---
"solid-optimizer": patch
---

Rename the closing tag that inlining adds when a self-closing tag gets children through a spread. The copy renamed the opening tag but wrote the closing tag with the old name, so `<Root {...rest} />` became `<Root$1 ...>Saved</Root>` and the output did not parse.
