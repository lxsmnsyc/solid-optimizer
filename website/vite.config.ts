import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solid from 'solid-optimizer/vite';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(fileURLToPath(import.meta.url));

// The REPL runs both compilers as WebAssembly with threads, which needs
// SharedArrayBuffer, and so a cross-origin isolated page.
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// `oxc-parser` loads its WebAssembly binding by name. The binding is a
// dependency of this site, not of the parser, so point the name at it.
const OXC_BINDING = path.dirname(require.resolve('@oxc-parser/binding-wasm32-wasi/package.json'));

export default defineConfig({
  // The site is built with the optimizer it shows.
  plugins: [solid()],
  resolve: {
    alias: [
      {
        find: /^@oxc-parser\/binding-wasm32-wasi$/,
        replacement: path.join(OXC_BINDING, 'parser.wasi-browser.js'),
      },
      { find: /^@oxc-parser\/binding-wasm32-wasi\//, replacement: `${OXC_BINDING}/` },
    ],
  },
  optimizeDeps: {
    // Prebundling would move the WebAssembly files away from their loaders.
    exclude: ['oxc-parser', '@oxc-parser/binding-wasm32-wasi', '@solidjs/compiler-wasm32-wasi'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    // Each page is its own entry, so the landing page and the docs never load the REPL.
    rolldownOptions: {
      input: {
        home: path.join(ROOT, 'index.html'),
        repl: path.join(ROOT, 'repl/index.html'),
        docs: path.join(ROOT, 'docs/index.html'),
      },
    },
    // The compilers are large, but only the REPL worker loads them.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    headers: ISOLATION_HEADERS,
    fs: { allow: ['..'] },
  },
  preview: {
    headers: ISOLATION_HEADERS,
  },
});
