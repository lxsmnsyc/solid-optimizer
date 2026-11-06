---
goal: Choose what to add to or expand in the Solid 1 optimizer (main branch, published 0.4.0) for the 0.5.0 release, ranked by bundle-size gain per unit of work
date: 2026-10-29
rounds: 2 of 2
status: saved, Solid 1 half only (the 0.5.0 question covers both the Solid 1 and Solid 2 compilers)
roadmap: none
supersedes: none
decision: none
---

# Debate: what goes into solid-optimizer 0.5.0

Scope note: the 0.5.0 question covers both the Solid 1 compiler (`main`) and the Solid 2 compiler (`solid-2-compiler`). This debate framed it as Solid 1 only, so it answers half of it. A follow-up debate for the Solid 2 compiler should pass `--supersedes debates/v0.5.0` and reuse the facts here.

0.5.0 ships from `main`, the Solid 1 line (J1). The user chose "measured gains only" (Q1): a change ships when a build of an example app shows the bytes, not to match the Solid 2 line.

The main finding is that the Solid 1 examples have little headroom left for the current inline pass. The optimized solid-ui build still has 855 of its 916 `createComponent` calls, and almost all of the calls left are in package code (Kobalte, the router) or in wrappers that spread props (J6, J10, O9).

## Settled structure

1. One small PR: move component statements into Solid's untracked callbacks, ported from `632fb35`. The callbacks are the `<For>` and `<Index>` callbacks, the `<Show>` and `<Match>` callbacks that take a parameter, and the callback given to `render` (P1, P8). A `<Show>` callback without a parameter is tracked in Solid 1.9.15, so it keeps the current rule. Runtime tests cover it, `Match`, and hydration (O8). Expect about 15 calls on solid-ui and tens of bytes (O1, O11). The changeset says the size change is small.
2. A 20-minute measurement before anything else is built. List the 56 `props-use` refusals on solid-ui and group them by cause (P9, O9). Build a fix only if one group of app code covers 20 or more calls, and ship it only with a byte delta from an `OPTIMIZE=1` solid-ui build.

Nothing else is planned for 0.5.0. The Solid 2 ports `<For>` unroll, `<Dynamic>` fold, JSX arrow reduction, `children()` and ref forwarding wait for a measured Solid 1 case (P4, P7).

## Budget

- device: no limit needed. A main worktree installs in about 1 s and solid-ui builds in about 4 s on this machine (J8).
- time: about 1.5 h for item 1 and 20 minutes for item 2. Each later fix is gated on a measured gain (P8, P9).
- tokens: one worker and one review for item 1. No roadmap.
- correctness: every change keeps Solid 1's tracking rules and has a runtime test, including hydration (O8).

## Rejected

- Copying components from `@kobalte/core` (P5): the T1 proof measured 0 B in every chunking. The copies are then refused as `copy-props-use`, `copy-call-spread`, `copy-call-ref` and `copy-shape` (J10, O5).
- Folding `define` and `import.meta.env`, and constant memos (P3): the examples have 0 uses of `import.meta.env` and 2 constant memos, and chunk mode runs after Vite's replacement (O3).
- `Context.Provider` member tags (P6): the providers the report lists come from packages, and the router's subtrees stay anyway (O4).
- Recommending single or vendor chunking (A2, O7): the benchmark sums every chunk, so a single chunk looks smaller while it loads the whole app at once.
- Inlining `Icon` into the 78 icon wrappers (O7): copying the wrappers measured +124 to 197 B (J9), and a spread at the call site needs `mergeProps`, which roadmap item 2 step 3 does not plan.
- Spending the rest of the time on build speed (A3): this is outside a goal about bundle size. The 1 s bound is also not reachable (O10).
- Porting every Solid 2 feature for parity: the user's Q1 answer.

## Proofs

- T1 for P5: does copying `@kobalte/core` shrink solid-ui? Done. It saved 0 B in default, vendor and single chunking, and the output was byte-identical. Allowing the copy is 1 line. Following Kobalte's barrel re-exports is 40 to 80 lines in a real version. The inline pass refuses the copies (cap 90 min and 150k tokens, agreed through Q2; it used about 35 min and 72k).

## Prior art

- Roadmap item 9, which says package copies add little: confirmed on Solid 1 by T1 (J10).
- Commit `147b4c4` found that copying icon wrappers grew solid-ui by 124 to 197 B (J9).
- Roadmap item 1 moved the Solid 2 demo by 12 B and Hacker News by 0 with the same untracked-callback rule. P1 is cheap, not a headline (O2).
- The Solid 2 demo's −28 to −32% came from a static app with constant tables. The Solid 1 examples have no such pattern (J5, P4).

## Open risks

- Measuring copies with the module's constant data (P2): no Solid 1 case. Measurement: port it only when a Solid 1 app has a component that reads a constant list it is given.
- `props-use` group (P9): measurement, item 2 of the settled structure.
- 0.5.0 is close to size-neutral on both examples (O11). Accepted, because the user chose measured gains over parity. Confirm with `pnpm bench` that nothing grows.

## What would move the numbers

Out of scope for 0.5.0, recorded for 0.6.0. The refusals T1 exposed point at one feature: inlining a component whose call site passes a spread or a `ref` (`copy-call-spread` 39, `copy-call-ref` 25, `call-spread` 68) and that reads its props through more than one view (`copy-props-use` 91). This is roadmap item 2 step 3, which needs Solid's `mergeProps` in the output. It is the only lever the debate found that reaches Kobalte. Its gain is unmeasured, so it needs its own debate.

## Answers from the user

- Q1, parity or measured gains: measured gains only.
- Q2, Kobalte prototype or defer: prototype now. It ran as T1.

## Overruled

- none

## Cost of this debate

- 2 rounds and 1 proof, about 290k tokens recorded. Ledger: `ledger.json`. Evidence: `evidence/`.
