---
title: compile and readModuleConstants
description: The signatures, options, and types of the solid-optimizer package.
type: reference
---

```ts
import { compile, readModuleConstants } from 'solid-optimizer';

function compile(code: string, options?: CompileOptions): CompileResult;

function readModuleConstants(
  code: string,
  options?: Pick<CompileOptions, 'filename' | 'importedConstants' | 'globalConstants'>,
): ModuleConstants;
```

## compile {#compile}

`compile(code, options)` optimizes one module, or a bundled chunk that kept its JSX. The input is code with JSX, in `.js`, `.jsx`, or TypeScript files. The output keeps JSX too, so Solid's JSX transform runs after it. It throws a `SyntaxError` when the code does not parse. See [Errors](errors.md).

A server build and its client build must compile the same code with the same options. See [Hydration](../concepts/hydration.md).

### CompileResult {#compile-result}

```ts
interface CompileResult {
  code: string;
  map: SourceMap | null;
  skipped?: Skip[];
}
```

- `code` is the optimized code.
- `map` is the map from the output back to the input, or `null` when nothing changed or maps are off.
- `skipped` is what the last round left alone, and why, when `report` is set. The last round changes nothing, unless `maxPasses` stopped the rounds first.

## CompileOptions {#compile-options}

```ts
interface CompileOptions {
  filename?: string;
  fold?: boolean;
  inline?: boolean;
  contexts?: boolean;
  memos?: boolean;
  conditionals?: boolean;
  builtIns?: readonly string[];
  moduleSources?: readonly string[];
  builtInAliases?: Readonly<Record<string, string>>;
  constantVars?: boolean;
  importedConstants?: ImportedConstants;
  globalConstants?: Readonly<Record<string, Primitive>>;
  importedContexts?: Readonly<Record<string, readonly string[]>>;
  sharedComponents?: Readonly<Record<string, number>>;
  alwaysInline?: boolean;
  alwaysInlineComponents?: readonly string[];
  maxPasses?: number;
  tidy?: boolean;
  sourceMap?: boolean;
  report?: boolean;
}
```

### filename {#filename}

Type: `string`

Default: `'input.jsx'`

Picks the parser and names the source in the source map. `.ts`, `.tsx`, `.mts`, and `.cts` parse as TypeScript. Anything else parses as JSX.

### inline {#inline}

Type: `boolean`

Default: `true`

Replaces component calls with the component's JSX. See [Component inlining](../concepts/component-inlining.md).

### alwaysInline {#always-inline}

Type: `boolean`

Default: `false`

Inlines every component that can be, even where the copies are larger than the calls they replace. See [Only where it is smaller](../concepts/component-inlining.md#only-where-it-is-smaller).

### alwaysInlineComponents {#always-inline-components}

Type: `readonly string[]`

Default: `[]`

Top-level components to inline wherever they can be, like `alwaysInline` does for every component. The Vite plugin lists the copies from `optimizer.packages` here.

### contexts {#contexts}

Type: `boolean`

Default: `true`

Removes context providers whose readers are all visible. See [Context inlining](../concepts/context-inlining.md).

### memos {#memos}

Type: `boolean`

Default: `true`

Replaces a memo that always makes a new value and is read once with its computation. See [Memo inlining](../concepts/memo-inlining.md).

### conditionals {#conditionals}

Type: `boolean`

Default: `true`

Replaces a `<Show>` or `<Switch>` with a ternary. See [Show and Switch lowering](../concepts/show-switch.md).

### fold {#fold}

Type: `boolean`

Default: `true`

Folds constants, removes unreachable code, and resolves control flow whose props are constants. See [Folding and control flow](../concepts/folding.md).

### builtIns {#built-ins}

Type: `readonly string[]`

Default: `['For', 'Show', 'Switch', 'Match', 'Loading', 'Reveal', 'Portal', 'Repeat', 'Dynamic', 'Errored']`

The names of Solid's built-in components. A tag only folds when it is one of them. An empty list turns control-flow folding off.

### moduleSources {#module-sources}

Type: `readonly string[]`

Default: `['solid-js', '@solidjs/web']`

The modules that export Solid's built-in components. A tag imported from anywhere else is a different component.

### builtInAliases {#built-in-aliases}

Type: `Readonly<Record<string, string>>`

Default: none

Top-level names that refer to Solid's built-ins, mapped to the built-in's name, like `{ Show$1: 'Show' }`. A bundler can rename a built-in in a chunk, or declare it instead of importing it.

### constantVars {#constant-vars}

Type: `boolean`

Default: `false`

Treats a top-level `var` that nothing writes to as a constant. Bundlers turn top-level `const` into `var`, so turn this on for bundled chunks.

### importedConstants {#imported-constants}

Type: `ImportedConstants`

Default: none

The constants of imported modules, keyed by the import specifier as the code writes it, then by export name. An import of one of them folds like a local `const`. See [readModuleConstants](#read-module-constants).

### globalConstants {#global-constants}

Type: `Readonly<Record<string, Primitive>>`

Default: none

Values of global names and paths, such as `{ __DEV__: false, 'import.meta.env.MODE': 'production' }`. A path starts at `import.meta` or at a name the module does not declare, and folds like a constant.

### importedContexts {#imported-contexts}

Type: `Readonly<Record<string, readonly string[]>>`

Default: none

The exports of imported modules that are contexts made by `createContext`, keyed by the import specifier as the code writes it. A provider of an imported context can then be removed like a local one.

### sharedComponents {#shared-components}

Type: `Readonly<Record<string, number>>`

Default: none

Top-level components that other modules use too, by the number of modules that use them, this one included. Inlining one only counts its share of the declaration, which goes away once every one of them inlines it. `0` keeps the declaration whatever is inlined, like a component that is also passed as a value.

### maxPasses {#max-passes}

Type: `number`

Default: `10`

The most rounds to run. One round can expose work for the next, such as an inlined component whose props now fold. Compilation stops early once a round changes nothing.

### tidy {#tidy}

Type: `boolean`

Default: `true`

Tidies the JSX the passes write: drops empty `{}` children, writes strings in braces such as `class={'card'}` or `{'Hello'}` as plain JSX, and unwraps a fragment that holds one element in a branch of `? :`, `&&`, `||` or `??`. Solid's JSX transform lowers the tidied JSX to the same code, so this only changes how the output reads. It runs only on a module the passes changed.

```tsx compare="input"
<p class={'card card-dark'}>{'Hello'}</p>
```

```tsx compare="output"
<p class="card card-dark">Hello</p>
```

An edit that could change what renders is left out. The children of an element with a `children` attribute or a spread stay as they are, and so do strings holding `&`, quotes, line breaks or spaces at their ends, and the strings of `style`, `ref`, `classList` and `on` attributes.

### sourceMap {#source-map}

Type: `boolean`

Default: `true`

Generates a source map.

### report {#report}

Type: `boolean`

Default: `false`

Records what the inline, provider, and memo passes leave alone, and why. The result lists them in `skipped`, each with its pass, a reason code, and a name. See [Report reasons](reasons.md).

## readModuleConstants {#read-module-constants}

`readModuleConstants(code, options)` reads what a module imports and the constants it exports, so that `compile` can fold them in the modules that import it. Only `filename`, `importedConstants`, and `globalConstants` of the options are used. Pass the result to `compile` as `importedConstants`.

It keeps `export const` bindings whose value folds, a `let` the module never writes to, `export default` of a constant, and names exported from them. `import * as config` also works, as `config.NAME`. A module that re-exports constants from another module takes that module's constants in its own `importedConstants`.

### ModuleConstants {#module-constants}

```ts
interface ModuleConstants {
  imports: string[];
  exports: Record<string, Primitive>;
}
```

- `imports` lists the modules this module imports or re-exports named bindings from, as written. `importedConstants` of `compile` takes their constants.
- `exports` holds the constants this module exports, by export name: `export const` bindings whose value folds, names exported from them, and names re-exported from `importedConstants`.

## Types

All of these are exported from `solid-optimizer`.

### ImportedConstants {#imported-constants-type}

```ts
type ImportedConstants = Readonly<Record<string, Readonly<Record<string, Primitive>>>>;
```

The constants each imported module exports, keyed by the import specifier as the module writes it, then by export name.

### Primitive {#primitive}

```ts
type Primitive = string | number | boolean | null | undefined;
```

### Skip {#skip}

```ts
interface Skip {
  readonly pass: SkipPass;
  readonly reason: string;
  readonly name: string;
}
```

Something a pass left alone, and why. `reason` is a short code, like `call-spread`. `name` is the component, context, or memo it is about. See [Report reasons](reasons.md).

### SkipPass {#skip-pass}

```ts
type SkipPass = 'inline' | 'contexts' | 'memos';
```

The passes that record what they leave alone.

## Types from solid-optimizer/vite {#vite-types}

### Options {#options}

```ts
interface Options extends Partial<SolidPluginOptions> {
  optimizer?: OptimizerOptions | false;
}
```

The options of `@solidjs/vite-plugin`, plus `optimizer`. See [Vite plugin options](vite-options.md).

### OptimizerOptions {#optimizer-options}

```ts
interface OptimizerOptions extends Pick<
  CompileOptions,
  'fold' | 'inline' | 'alwaysInline' | 'contexts' | 'memos' | 'conditionals' | 'maxPasses'
> {
  mode?: 'auto' | 'module';
  dev?: boolean;
  report?: boolean | ((report: OptimizerReport) => void);
  packages?: readonly string[];
}
```

### OptimizerReport {#optimizer-report-type}

```ts
interface OptimizerReport {
  readonly environment: string;
  readonly skips: readonly Skip[];
}
```

What the optimizer left alone in one build environment. `environment` is the Vite environment, like `client` or `ssr`.

## Related

- [Use compile without Vite](../guides/compile-api.md) for the steps.
- [Vite plugin options](vite-options.md) for the plugin.
- [Report reasons](reasons.md) for the values of `Skip.reason`.
