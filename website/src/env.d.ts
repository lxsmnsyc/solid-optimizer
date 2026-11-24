declare module '@solidjs/compiler-wasm32-wasi' {
  export * from '@solidjs/compiler';
}

interface ImportMetaEnv {
  /** The site's origin, for absolute URLs in link previews. Set in vite.config.ts. */
  readonly SITE_URL: string;
}

declare module 'virtual:docs-manifest' {
  /** Every doc's slug, title, description, type and source file. See plugins/content.ts. */
  const manifest: {
    slug: string;
    title: string;
    description: string;
    type: string;
    file: string;
  }[];
  export default manifest;
}
