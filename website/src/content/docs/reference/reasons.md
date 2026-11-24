---
title: Report reasons
description: Every reason code in the report, by pass, with what it means.
type: reference
---

```ts
interface Skip {
  readonly pass: 'inline' | 'contexts' | 'memos';
  readonly reason: string;
  readonly name: string;
}
```

`skip.pass` is `'inline'`, `'contexts'` for the provider pass, or `'memos'`. `skip.reason` is one of the codes below, and `skip.name` is the component, context, or memo. Tables are by pass, then by the order the pass checks. See [Find out why a component stays](../guides/report.md) for how to read them.

## Inline pass {#inline-pass}

| Reason                                                                                                                                      | Meaning                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `props-use`, `view-use`                                                                                                                     | The component uses its props in a way other than `props.name`, a spread onto an element, or a `merge()` or `omit()` view, such as passing them to a function.                                                                                                        |
| `view-conflict`                                                                                                                             | A spread of the props would repeat an attribute the element already has.                                                                                                                                                                                             |
| `component-params`, `component-body`, `component-return`, `component-directive`, `component-async`, `component-recursive`, `component-this` | The component's own shape is not supported: more than one parameter, a body that does not end in its only `return` of JSX, a directive like `'use strict'`, an async or generator function, a call of itself, or a use of `this` or `arguments`.                     |
| `component-mutated`                                                                                                                         | Something assigns to the component's name after its declaration.                                                                                                                                                                                                     |
| `component-write`                                                                                                                           | The component's statements assign to something declared outside it, like a counter at the top of the module. A copy's statements run before the JSX around the call, so that JSX would see the write too early.                                                      |
| `call-spread`, `call-namespace`, `call-duplicate`                                                                                           | The call site passes a spread, a namespaced attribute, or the same attribute twice.                                                                                                                                                                                  |
| `call-children`                                                                                                                             | The call site passes both a `children` attribute and children between its tags.                                                                                                                                                                                      |
| `call-this`                                                                                                                                 | An attribute or a child at the call site uses `this` or `arguments`, which would mean something else inside the copy.                                                                                                                                                |
| `call-ref`, `ref-use`                                                                                                                       | The call's `ref` is an expression other than a name, a function, or an array of them, or the component uses `props.ref` other than as a `ref`.                                                                                                                       |
| `prop-value`                                                                                                                                | A prop's value cannot take the place of the component's reads of it.                                                                                                                                                                                                 |
| `shadowed`                                                                                                                                  | A name the component reads from its module is declared again around the call, so the copy would read the wrong binding.                                                                                                                                              |
| `no-host`                                                                                                                                   | The component has statements, and the call is not in JSX that a component or one of Solid's callbacks returns. A `<Show>` child or a `fallback` is one such place.                                                                                                   |
| `context-value`                                                                                                                             | The component reads a context that a removed provider answers, and the read cannot take the provider's value at the call.                                                                                                                                            |
| `size`                                                                                                                                      | The copies would be larger than the calls. See [Only where it is smaller](../concepts/component-inlining.md#only-where-it-is-smaller).                                                                                                                               |
| `lazy`, `not-a-function`, `imported`, `nested`, `global`, `member-tag`                                                                      | The tag is not a component declared at the top of the same module or chunk: a `lazy()` component, a binding that is not a function, an import, a component declared inside a function, a global, or a tag like `<Menu.Item>` that is not a known compound component. |

## Copies from other modules {#copies}

The Vite plugin reports these with the pass `'inline'`.

| Reason                                   | Meaning                                                                                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copy-external`, `copy-package`          | The component's module is external to the bundle, or is in a package that `optimizer.packages` does not list.                                                                           |
| `copy-not-jsx`                           | The component's module is not one the official plugin lowers.                                                                                                                           |
| `copy-cycle`                             | The component's module imports the importer back, directly or through other modules.                                                                                                    |
| `copy-shape`                             | The export is not a component the inline pass can read.                                                                                                                                 |
| `copy-wrapper`                           | The component only returns a call of another component in its module.                                                                                                                   |
| `copy-virtual`                           | The copy would import a virtual module that its specifier does not reach from the importer.                                                                                             |
| `copy-size`, `copy-no-host`, `copy-left` | The copy was made but did not inline. `copy-` comes before the inline reason, such as `copy-size`. `copy-left` means no reason was recorded.                                            |
| `missing-helper`                         | Chunk mode: the chunk needs a runtime helper that no module in it imports, so the chunk is lowered as written. The build also prints a warning. See [Errors](errors.md#missing-helper). |

## Provider pass `contexts` {#provider-pass}

| Reason                                                                               | Meaning                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open-component`, `open-call`, `open-new`, `open-spread`, `open-outer`, `open-other` | Code under the provider that the pass cannot see into: a component that does not inline, a call of an unknown function, `new`, a spread, another component's props, or anything else that could read the context. |
| `provider-nested`                                                                    | A provider of the same context sits under this one.                                                                                                                                                               |
| `provider-value`                                                                     | A read cannot take the provider's value as written where it reads it.                                                                                                                                             |
| `provider-undefined`, `provider-shape`                                               | The provider's `value` could be `undefined`, or the tag has attributes other than `value`.                                                                                                                        |

## Memo pass `memos` {#memo-pass}

| Reason                                       | Meaning                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memo-computation`, `memo-options`           | The memo's computation is not a function that returns one expression, or it has options other than `{ equals: false }`.                           |
| `memo-async`                                 | A memo with `equals: false` may return a promise or an async iterable.                                                                            |
| `memo-reads`, `memo-read`, `memo-read-place` | The memo is read more than once, read other than as a call with no arguments, or read somewhere other than the whole of a tracked JSX expression. |
| `memo-declaration`                           | The declaration holds more than one binding, or is not inside a function.                                                                         |
| `memo-scope`                                 | A name the computation reads means something else at the read, or the computation uses `this`.                                                    |
| `children-dynamic`                           | A `children()` helper whose computation returns something other than JSX.                                                                         |

## Related

- [Find out why a component stays](../guides/report.md) for the fix to common reasons.
- [compile and readModuleConstants](compile.md#skip) for the `Skip` type.
- [strategy.md](https://github.com/lxsmnsyc/solid-optimizer/blob/main/strategy.md) for the exact rules of each pass.
