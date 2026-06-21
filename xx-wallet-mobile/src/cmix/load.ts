/**
 * Lazy loader for the xxDK WebAssembly client (`xxdk-wasm`).
 *
 * xxDK is loaded on demand and exactly once. The ~40 MB wasm is not fetched
 * until the first cMix operation (a private-indexer query or a memo), and the
 * initialised utils table is reused for the app's lifetime. This mirrors the
 * lazy one-shot pattern in `keyring/sleeve.ts` and the dynamic-import lazy load
 * of the Ledger module, so users who never opt into a cMix feature pay nothing
 * in their initial bundle.
 *
 * NOTE ON THE API SURFACE. `xxdk-wasm`'s exported `XXDKUtils` type covers the
 * cMix lifecycle (NewCmix / LoadCmix / follower) and the DM + Channels messaging
 * stack, but NOT the older e2e auth-channel bindings (Login / SendE2E / Request /
 * Confirm). Those are present at runtime as raw wasm globals on `globalThis`;
 * any module that uses them declares its own types and resolves from
 * `globalThis` (see the e2e layer). This loader only deals with the typed surface.
 *
 * Self-hosting the wasm same-origin + the service-worker caching strategy is a
 * later task (build plan A3); until then xxdk-wasm fetches from its default CDN.
 */
import type { XXDKUtils } from 'xxdk-wasm';

/** The lazily-imported pieces of `xxdk-wasm` the wallet uses directly. */
interface XXDKModule {
  InitXXDK: () => Promise<XXDKUtils>;
  GetDefaultNDF: () => string;
  setXXDKBasePath: (path: URL) => void;
}

export interface LoadedXXDK {
  /** The initialised xxDK utils table (NewCmix, LoadCmix, GetDefaultCMixParams, …). */
  utils: XXDKUtils;
  /** The mainnet network definition JSON, needed by NewCmix. */
  getDefaultNDF: () => string;
}

export interface LoadXXDKOptions {
  /**
   * Override the wasm asset base path (e.g. a self-hosted same-origin copy).
   * Omit to use xxdk-wasm's default CDN. Used by A3 self-hosting and by tests.
   */
  basePath?: URL;
  /** Test hook: inject a stand-in module instead of `import('xxdk-wasm')`. */
  moduleOverride?: XXDKModule;
}

let initPromise: Promise<LoadedXXDK> | null = null;

/**
 * Load + initialise xxDK once, returning the cached result on every subsequent
 * call. On failure the cache is cleared so the next call retries cleanly rather
 * than returning the cached rejection forever (matches `initSleeve`).
 */
export function loadXXDK(opts: LoadXXDKOptions = {}): Promise<LoadedXXDK> {
  if (!initPromise) {
    initPromise = doLoad(opts).catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function doLoad(opts: LoadXXDKOptions): Promise<LoadedXXDK> {
  // Deliberately not annotated `XXDKModule`: xxdk-wasm's own types declare
  // GetDefaultNDF as `() => String` (the wrapper object), which is incompatible
  // with our primitive `string`. We coerce on the way out instead of fighting it.
  const mod = opts.moduleOverride ?? (await import('xxdk-wasm'));
  if (opts.basePath) {
    mod.setXXDKBasePath(opts.basePath);
  }
  const utils = await mod.InitXXDK();
  // xxdk-wasm types GetDefaultNDF as `() => String`; coerce to a primitive string.
  return { utils, getDefaultNDF: () => String(mod.GetDefaultNDF()) };
}

/**
 * Whether xxDK has been loaded + initialised in this session (or is loading).
 * Lets callers show "already connected" affordances without forcing a load.
 */
export function isXXDKLoaded(): boolean {
  return initPromise !== null;
}
