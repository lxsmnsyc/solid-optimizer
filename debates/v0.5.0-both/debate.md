---
goal: Choose what to add to or expand in both the Solid 1 compiler (main) and the Solid 2 compiler (solid-2-compiler) for the 0.5.0 release, ranked by measured bundle-size gain per unit of work
date: 2026-10-29
rounds: 1 of 1 (short debate)
status: proposed
roadmap: none
supersedes: debates/v0.5.0/debate.md
decision: none
---

# Debate: 0.5.0 for both compilers

This reruns `debates/v0.5.0`, which covered Solid 1 only. Its input is `debates/v0.5.0/room.md`, which measured where the bytes go on both lines.

On the example apps, app code and compiler output are 15 to 23% of each bundle (J1). The current passes work only on that part, so no pass in this release can move an app by more than a few percent. The largest measured lever is the Solid 2 runtime itself (J3), and it needs work in Solid, which is out of scope for now (Q1).

## Settled structure

1. Solid 1: move component statements into untracked callbacks. The callbacks are `<For>`/`<Index>`, `<Show>`/`<Match>` with a parameter, and `render`. Port it from Solid 2 with runtime tests that cover `<Show>` without a parameter, `Match`, and hydration (P1). Tens of bytes (O4).
2. Solid 2: roadmap item 1 step 3. Wrap the statements of a component in a `<Show>` child or `fallback` in `untrack(() => ...)`, only when the estimate says it is smaller. The demo's `Home` is the case to measure (P5). Tens of bytes (O4).
3. Both lines, spike before any build: inlining across a spread or `ref` at the call site (P3). In a scratch build, skip the `call-spread` and `call-ref` checks and count what then inlines on solid-ui, and what is still refused as `props-use`. Build it with `mergeProps` only if the count and the bytes justify it. Cap: 30 minutes, 100k tokens.
4. Upstream, not gating the release: send the JSX lowering leftovers to `@solidjs/compiler` and dom-expressions (A1). These are unused DOM walks, a function called at once around each element, and repeated dynamic reads. This was measured at 26 to 47 B per page, about 1 to 2% of app code (J2).

The changesets should say that 0.5.0 changes sizes by tens of bytes on the example apps.

## Budget

- device: no limit needed. Builds take seconds, and a worktree install about 1 s.
- time: about 1.5 h each for items 1 and 2, and 30 minutes for the spike in item 3.
- tokens: one worker and one review per item. About 100k for the spike.

## Rejected

- Cleaning the lowering leftovers inside the optimizer (P2): it matches another compiler's output, which breaks when that output changes, and module mode would not get it (O1). Q2 left the choice to the judge, and fixing it upstream reaches every Solid app (A1).
- Runtime feature flags for `@solidjs/signals` (P4): Q1, not now. This is the largest future lever: async, transition and error-status code is most of the 12.3 kB the demo ships (J3, O3).
- From the earlier debate: copying `@kobalte/core` (0 B, T1), define and env folding, `Context.Provider` handling, and advice on chunking.

## Proofs

- None in this round. T1 from `debates/v0.5.0` applies: copying Kobalte saved 0 B (J5).

## Prior art

- Vue's compile-time feature flags drop runtime features an app does not use. This is the model for P4 (J3).
- Roadmap item 1 moved the Solid 2 demo by 12 B (O4).
- Roadmap item 2 notes that chunk-mode passes do not know `mergeProps`' local name. Item 3 has to solve that (O2).

## Open risks

- Inlining across a spread or `ref` may be blocked by `props-use` anyway (O2). The spike in item 3 measures this.
- 0.5.0 is close to size-neutral on the examples. Accepted: the measured room inside the optimizer's reach is small on these apps (J1).

## Answers from the user

- Q1, can you drive runtime flags in Solid: not now.
- Q2, where to fix the lowering leftovers: whichever is optimal. The judge chose upstream.

## Overruled

- none

## Cost of this debate

- 1 round, about 45k tokens, plus the room measurements in `debates/v0.5.0/room.md`.
