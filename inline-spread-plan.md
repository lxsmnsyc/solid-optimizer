# Plan: spreads and `ref` in component inlining

This plan covers the component shapes that inlining rejects today and that idiomatic Solid code uses. It lists the steps in the order they should land.

## What is rejected today

These results come from `compile` with `alwaysInline: true` on the current `solid-2-compiler` branch.

| Shape                                                    | Inlines | Why                                                      |
| -------------------------------------------------------- | ------- | -------------------------------------------------------- |
| `function Box(props) { return <div {...props} />; }`     | no      | A reference to `props` that is not `props.name`.         |
| `<Title {...p} />` with an unknown `p`                   | no      | `attributesOf` rejects every spread at a call site.      |
| `<Field ref={el} />` with `<input ref={props.ref} />`    | no      | `attributesOf` rejects `ref`.                            |
| A wrapper that spreads an `omit()` view onto a component | yes     | The view becomes attributes, so the inner call is plain. |
| `if (FLAG) return null;` with a constant `FLAG`          | yes     | Fold removes the branch before inline checks the body.   |

Destructured props and early returns that depend on props are out of scope. Both break reactivity in Solid, so idiomatic code does not use them.

## Step 0: measure

Find out which rejection matters most on real apps before writing the fixes.

1. Add a debug option to the inline pass that records why each call site was not inlined. Use a short reason code, such as `call-spread`, `call-ref`, `param-spread`, `size`, or `shape`.
2. Report the counts per reason from the Vite plugin when the option is set.
3. Run it on the demo, solid-ui, and Hacker News.
4. Reorder steps 1 to 3 if the counts disagree with the order below.

The option stays after the work is done. It helps explain future size results.

## Step 1: spread of the props parameter

`<div {...props} />` inside a component is the cheapest fix. It is the same as a spread of a view with one source and no hidden keys, which `resolveViews` already handles.

1. In `analyzeViews`, accept a reference to the props parameter whose parent is a `JSXSpreadAttribute` on a `JSXElement`.
2. Record it as a `ViewSpread` whose view is `{ sources: [{ defaults: undefined, hidden: new Set() }] }`.
3. Skip that reference in the `propRead` loop in the component analysis.
4. The existing rules still apply. A key the element already has, or `children` on an element with children, blocks the call site.

Tests:

- `<div {...props} />` with plain attributes and with children.
- A spread next to an attribute the call site also passes. This must not inline.
- A spread onto another component, which then inlines in the next round.
- Runtime equivalence in `behavior.test.ts`, with a signal prop that changes.

## Step 2: `ref` at the call site

Solid lowers `ref` on a component into a `ref(r$)` prop function. On an element it lowers `ref` into a call to `ref()`. The inlined copy can pass the call site's expression straight to the element when the component only forwards it.

1. In `attributesOf`, allow `ref` when it is a plain `JSXAttribute`.
2. Inline the call site only when every read of `ref` is one of these:
   - the whole value of a `ref` attribute on an intrinsic element, as `ref={props.ref}`;
   - a key of a view or props spread onto an intrinsic element;
   - the whole value of `ref` on another component, which a later round resolves.
3. Reject any other read, such as `props.ref?.(el)` or `typeof props.ref`. The prop is a compiler-made function there, not the call site's expression.
4. A component that never reads `ref` drops it. Check that the original output does the same, since the `ref(r$)` function is never called.

Check before writing the code:

- When the component ref runs, compared with the element ref. The component form calls `applyRef` when the component calls `props.ref`. The element form calls `ref(() => value, el)`. List any timing difference under accepted differences, or reject the case.
- All three ref forms: a `let` that gets assigned, a function, and an array like `ref={[a, b]}`.

Tests cover each form, a forwarded ref through `omit()`, and a rejected read.

## Step 3: spread of an unknown object at the call site

`<Title {...p} label="x" />` lowers to `createComponent(Title, mergeProps(p, { label: "x" }))`. The copy can do the same without the component call.

1. Allow a `JSXSpreadAttribute` in `attributesOf`. Return the attributes and spreads in source order.
2. When a call site has a spread, store its props in a `const` in the host, the way stored props already work:

   ```jsx
   const props$1 = merge(p, { label: 'x' });
   ```

   A dynamic attribute becomes a getter, as the JSX transform writes it.

3. Rename the props parameter in the copy to that `const`. Keep reads as `props$1.name`.
4. Keep the view declarations in the copy as real `merge()` and `omit()` calls, renamed like other locals. They cannot be resolved without knowing the keys.
5. Keep view spreads onto elements as real spreads.
6. A call site with a spread needs a host, since the `const` has to run where the component would have been created. Without a host it does not inline.

Later, as a separate change, a key that comes after the last spread can resolve statically, since nothing can override it.

Size estimate:

- The call side already counts `createComponent`. Add the `mergeProps` call and its getters.
- The copy side counts the `merge` call, its getters, and the kept view calls.
- The copy still wins when it joins the host's template. Check this on solid-ui, where most wrappers spread.

Tests:

- An unknown spread with attributes before and after it.
- A spread with a view in the component.
- A call site with no host. This must not inline.
- Runtime equivalence when the spread object gains a key later.

## Step 4: finish

1. Update the inlining rules in `README.md` and the comment at the top of `inline.ts`.
2. Add a section to `strategy.md` with the accepted differences from step 2.
3. Add a changeset for each user-visible step.
4. Run `pnpm bench` and the three apps. Update `benchmarks.md` and the results table in `strategy.md`.
5. Port the steps to the `solid-1-compiler` branch, where the views are `mergeProps` and `splitProps`.

## Not planned

- Namespaced attributes at a call site, such as `on:click`. These are rare on components.
- Destructured props and early returns that read props, as explained above.
