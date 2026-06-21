/**
 * Ambient module declaration for `xxdk-wasm`.
 *
 * The package ships real TypeScript declarations under `dist/src/`, but its
 * package.json `types` field points at a non-existent `dist/index.d.ts`, so
 * TypeScript can't resolve the bare `xxdk-wasm` specifier and falls back to the
 * untyped `dist/bundle.js` (TS7016). Re-export the real declarations here so
 * imports of `xxdk-wasm` are properly typed (XXDKUtils, InitXXDK,
 * setXXDKBasePath, GetDefaultNDF, …).
 *
 * If xxdk-wasm later fixes its `types` field, this file can be deleted.
 */
declare module 'xxdk-wasm' {
  export * from 'xxdk-wasm/dist/src/index';
}
