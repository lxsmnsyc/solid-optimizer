# Contributing to solid-optimizer

## Setup

Pull requests go against `main`.

1. Fork the repository and clone it.
2. Create a branch.

   ```bash
   git checkout -b MY_BRANCH_NAME
   ```

3. Enable pnpm through Corepack. The version comes from `packageManager` in `package.json`.

   ```bash
   corepack enable
   ```

4. Install dependencies.

   ```bash
   pnpm install
   ```

## Commands

Run these from the repository root.

- `pnpm build` builds the package with [tsdown](https://tsdown.dev/).
- `pnpm test` runs the tests with [Vitest](https://vitest.dev/).
- `pnpm type-check` type-checks everything with TypeScript 7.
- `pnpm lint` runs [oxlint](https://oxc.rs/docs/guide/usage/linter). `pnpm lint:fix` applies fixes.
- `pnpm fmt` formats with [oxfmt](https://oxc.rs/docs/guide/usage/formatter). `pnpm fmt:check` only checks.
- `pnpm bench` builds every example with and without the optimizer and writes their bundle sizes and build times to [`benchmarks.md`](benchmarks.md). Build the package first. Each pull request also gets a comment comparing its numbers with its base branch.

## Releases

Releases use [changesets](https://github.com/changesets/changesets).

1. Add a changeset for any change that affects the published package.

   ```bash
   pnpm cs:add
   ```

2. Merge the pull request into `main`.
3. The release workflow opens a "Version Packages" pull request. Merging it publishes the new version to npm.
