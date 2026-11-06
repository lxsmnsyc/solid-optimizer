# Where the room is

The 0.5.0 debate (`debate.md`) only looked for room in two places: Solid 2 features that Solid 1 lacks, and the optimizer's report. The report only lists what an existing pass tried and declined. This file measures the room outside the current passes, on both compilers. It is the input for a debate on 0.5.0 that covers both lines.

Measured on 2026-10-29, default chunking, optimized builds. Evidence and scripts are in `evidence/`.

## 1. Where the bytes go

`evidence/byte-split.ts` splits each build by Rolldown's `//#region` markers. Each region is minified on its own, without compression, and gets its share of the chunk's gzip size. The per-category numbers come out about 9% high, and chunk-mode rewriting moves some code between regions. The chunk totals are exact.

| App                 | Total gzip | Solid runtime | Packages                                                   | App code and compiler output |
| ------------------- | ---------- | ------------- | ---------------------------------------------------------- | ---------------------------- |
| Solid 2 demo        | 17.8 kB    | 15.1 kB (85%) | none                                                       | 2.7 kB (15%)                 |
| Solid 2 Hacker News | 29.4 kB    | 16.7 kB (57%) | router 8.4 kB (28%)                                        | 4.4 kB (15%)                 |
| Solid 1 Hacker News | 16.6 kB    | 8.4 kB (51%)  | router 4.4 kB (26%)                                        | 3.9 kB (23%)                 |
| Solid 1 solid-ui    | 207.9 kB   | 12.1 kB (6%)  | chart.js 60, Kobalte 34, TanStack 13.5, others about 40 kB | 47.6 kB (23%)                |

Component inlining, folding and memo removal only change the last column. The Solid 2 demo's −32% came from the runtime column: once the app turned static, it no longer needed some runtime helpers.

In the Solid 1 Hacker News build, the runtime regions looked about 0.5 kB larger after optimizing. A diff of top-level runtime functions shows that the optimized build adds none and only drops some. The growth is region drift, not new runtime code.

Output: `evidence/byte-split-default.txt`.

## 2. Room in the code the compiler writes

`evidence/ceiling.ts` counts two leftovers of JSX lowering in the built chunks:

- DOM walks whose result is unused, like `_el$2.firstChild;`. There are 2 to 8 per app, and the minifier keeps about half. Removing them saves 26 to 44 B gzip per app.
- A function called at once around one element, like `(() => { var _el$ = _tmpl$(); ...; return _el$; })()`. There are 1 to 81 per app, 81 in solid-ui.

A hand-written version of the Solid 2 Hacker News user page (`evidence/user-hand.js`, against `user-orig.js`) keeps the same runtime calls and behavior. It drops the unused walks, turns the wrapper functions into plain statements, and computes the two `href` strings from one `user().id` read. The page chunk went from 625 to 578 B gzip (−47 B, −7.5%).

Outcome for the unused walks, 2026-10-29: fixed in both Solid 2 compilers on branch `perf/compiler-unused-walks` of the `lxsmnsyc/solid` fork (commit `7193ee802`, local only). Measured against the published rc.19 compiler on the Solid repo's 13 examples, client gzip changed by 0 to −24 B, and hydrating examples did not change (`evidence/unused-walks-solid-examples.txt`). On this repo's examples it was −7 to −43 B (`evidence/unused-walks-apps.txt`). Parked: the gain does not justify 25 changed snapshot files upstream. The wrapper functions were not pursued: upstream `template.ts` has a comment declining to flatten them.

Applied to the last column of section 1, this is about 1 to 2% of each app. It is real but small. Some of it belongs upstream in dom-expressions, but chunk mode lowers JSX itself, so the optimizer controls this output.

## 3. Room in the Solid 2 runtime

`@solidjs/signals` is 12.3 kB of the Solid 2 demo's 17.8 kB. Its largest top-level declarations that ship in the demo are `computed`, `GlobalQueue`, `read`, `recompute`, `handleAsync`, `setSignal`, `resolveTx`, error status (`ERROR_SIGNAL`, `clearStatus`, `notifyStatus`) and boundaries. The core read and recompute path calls the async and transition code, so that code ships even in an app with no async value or transition.

This is the largest lever measured. The optimizer cannot use it alone. Solid would need a runtime build or compile-time flags that leave those features out, and the optimizer would prove an app does not use them.

Prior art: Vue's compile-time feature flags (`__VUE_OPTIONS_API__`, `__VUE_PROD_DEVTOOLS__`) let the bundler drop runtime features an app does not use. This is the same shape.

Outcome, 2026-10-29: dropped. A flag only helps an app that provably never uses async, and almost every app does. 12 of the Solid repo's 14 examples, and both of this repo's Solid 2 examples, use `lazy`, the router, `<Loading>`, `createAsync`, `action` or async memos. In Solid 2, async is part of the core graph and transitions build on it, so the only useful flag would be "no async at all".

`claimElement` calls appear on every `<a href>` in the Solid 2 Hacker News build. They run the router's link claim handlers, so they are needed.

## 4. Levers the debate did not consider

- **Runtime feature flags (Solid 2).** Up to several kB on small apps, from section 3. Needs a design agreed with Solid upstream.
- **Codegen cleanup in chunk mode (both lines).** About 1 to 2%, from section 2. Small, local, and low risk.
- **Inlining across a spread or a `ref` at the call site (both lines).** This is the only lever that reaches Kobalte, from T1 in `debate.md`. Its gain is unmeasured.
- **Shipping no client code for static subtrees in hydrating builds.** This is the islands and partial hydration approach of Marko, Astro and Qwik. It does not apply to the examples, which do not hydrate. It changes the architecture, not a pass.

Not compiler work, but measured: chart.js is 29% of solid-ui, and Vite's modulepreload polyfill is 0.25 to 0.7 kB per app (`build.modulePreload.polyfill`).
