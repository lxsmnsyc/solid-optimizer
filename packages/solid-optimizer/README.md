# solid-optimizer

> Experimental compile-time optimizer for SolidJS

[![NPM](https://img.shields.io/npm/v/solid-optimizer.svg)](https://www.npmjs.com/package/solid-optimizer) [![JavaScript Style Guide](https://badgen.net/badge/code%20style/airbnb/ff5a5f?icon=airbnb)](https://github.com/airbnb/javascript)

## Install

```bash
npm i -D solid-optimizer
```

```bash
yarn add -D solid-optimizer
```

```bash
pnpm add -D solid-optimizer
```

## Features

> **Warning**
> The following features are only for SSR

### Trimming no-op

The following are no-op functions in SSR, their calls are removed to enable tree-shaking unwanted code.

- `createEffect`
- `onMount`

### `untrack`, `batch` and `startTransition`

Passed argument is inlined and called synchronously. For arrow functions, if the function doesn't have the body, it's return expression is inlined instead.

### `createDeferred`

Passed argument is inlined.

### `getListener`

`getListener` calls are replaced with `null`.

## Sponsors

![Sponsors](https://github.com/lxsmnsyc/sponsors/blob/main/sponsors.svg?raw=true)
## License

MIT © [lxsmnsyc](https://github.com/lxsmnsyc)
