import { createRequire } from 'node:module';
import path from 'node:path';
import solid from 'solid-optimizer/vite';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);

// The REPL runs both compilers as WebAssembly with threads, which needs
// SharedArrayBuffer, and so a cross-origin isolated page.
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// `oxc-parser` loads its WebAssembly binding by name. The binding is a
// dependency of this site, not of the parser, so point the name at it.
const OXC_BINDING = path.dirname(require.resolve('@oxc-parser/binding-wasm32-wasi/package.json'));

// Link previews need absolute URLs. Vercel sets the production domain at
// build time. `SITE_URL` overrides it, for a preview or another host.
const SITE_URL =
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://solid-optimizer.vercel.app');

export default defineConfig({
  // The site is built with the optimizer it shows. Start mode renders each
  // page on the server, and `scripts/prerender.ts` writes them out as HTML,
  // which the client hydrates. See src/entry-server.tsx and src/entry-client.tsx.
  plugins: [solid({ ssr: true, start: true })],
  define: {
    'import.meta.env.SITE_URL': JSON.stringify(SITE_URL),
  },
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
