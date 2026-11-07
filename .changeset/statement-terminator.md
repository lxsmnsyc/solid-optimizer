---
"solid-optimizer": patch
---

End a component's moved statements with a semicolon. A last statement without one failed to parse when it moved into an arrow function that returns JSX, and it joined the next moved statement when that one started with a parenthesis.
