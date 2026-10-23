---
"solid-optimizer": patch
---

Fix chunk-mode builds that failed with "JSX expressions may not use the comma operator". Rolldown and Vite print `{(a, b)}` without its parentheses, and the plugin now puts them back.
