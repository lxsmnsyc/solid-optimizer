declare module '@solidjs/compiler-wasm32-wasi' {
  export * from '@solidjs/compiler';
}

interface ImportMetaEnv {
  /** The site's origin, for absolute URLs in link previews. Set in vite.config.ts. */
  readonly SITE_URL: string;
}
