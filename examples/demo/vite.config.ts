import solid from 'solid-optimizer/vite';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';

// `OPTIMIZER=off` builds the same app with `@solidjs/vite-plugin` alone, for comparison.
const optimized = process.env.OPTIMIZER !== 'off';

// `CHUNKS` picks how Rolldown splits the app:
// - `default` lets Rolldown decide. The runtime lands in the entry chunk.
// - `vendor` moves everything from node_modules into its own chunk, so every
//   app chunk imports the runtime helpers from another chunk.
// - `single` inlines every dynamic import, so the whole app is one chunk.
const chunks = process.env.CHUNKS ?? 'default';

function codeSplitting(): NonNullable<
  NonNullable<UserConfig['build']>['rolldownOptions']
>['output'] {
  switch (chunks) {
    case 'vendor':
      return { codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/ }] } };
    case 'single':
      return { codeSplitting: false };
    default:
      return {};
  }
}

export default defineConfig({
  plugins: [solid({ optimizer: optimized ? {} : false })],
  build: {
    outDir: `dist/${chunks}/${optimized ? 'optimized' : 'plain'}`,
    // Unminified output is easier to compare. Set `MINIFY=1` to compare sizes instead.
    minify: process.env.MINIFY === '1',
    rolldownOptions: { output: codeSplitting() },
  },
});
