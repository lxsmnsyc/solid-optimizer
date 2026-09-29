import solid from 'solid-optimizer/vite';
import { defineConfig } from 'vite';

// `OPTIMIZER=off` builds the same app with `@solidjs/vite-plugin` alone, for comparison.
const optimized = process.env.OPTIMIZER !== 'off';

export default defineConfig({
  plugins: [solid({ optimizer: optimized ? {} : false })],
  build: {
    outDir: optimized ? 'dist/optimized' : 'dist/plain',
    // Unminified output is easier to compare. Set `MINIFY=1` to compare sizes instead.
    minify: process.env.MINIFY === '1',
  },
});
