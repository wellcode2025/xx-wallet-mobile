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
  setXXDKBasePath: (path: string) => void;
}

export interface LoadedXXDK {
  /** The initialised xxDK utils table (NewCmix, LoadCmix, GetDefaultCMixParams, …). */
  utils: XXDKUtils;
  /** The mainnet network definition JSON, needed by NewCmix. */
  getDefaultNDF: () => string;
}

export interface LoadXXDKOptions {
  /**
   * Override the wasm asset base path (an absolute same-origin URL string).
   * Omit to use the default same-origin self-hosted path. Used by tests.
   */
  basePath?: string;
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
  // Default to the SAME-ORIGIN /xxdk-wasm path, served by a proxy (the Vite dev
  // server in dev, the Cloudflare Worker in prod — see worker/index.ts) that
  // fetches the assets from elixxir's CDN server-side. So the browser never
  // contacts a third-party CDN (connect-src stays 'self') and the 45MB wasm
  // stays off Cloudflare's 25 MiB static-asset cap. The base must be a STRING
  // (the xxdk API does string ops on it; a URL object is silently ignored).
  const basePath = opts.basePath ?? defaultBasePath();
  if (basePath) {
    // xxdk-wasm's published types declare setXXDKBasePath(path: URL), but its
    // runtime — and its own README — expect a STRING path (a URL object is
    // silently ignored). Pass the string through the mistyped signature.
    (mod.setXXDKBasePath as unknown as (path: string) => void)(basePath);
  }
  const utils = await mod.InitXXDK();
  // xxdk-wasm types GetDefaultNDF as `() => String`; coerce to a primitive string.
  return { utils, getDefaultNDF: () => String(mod.GetDefaultNDF()) };
}

/**
 * Same-origin base for the self-hosted xxdk assets. Returns undefined off the
 * main thread (no `window`), where the loader isn't used anyway.
 */
function defaultBasePath(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  // Origin-based + absolute — NOT location.href (which the xxdk README uses),
  // because href includes the current SPA route and would break when going
  // online from /multisig/:address. Resolves to the same-origin /xxdk-wasm proxy.
  return `${window.location.origin}/xxdk-wasm`;
}

/**
 * Whether xxDK has been loaded + initialised in this session (or is loading).
 * Lets callers show "already connected" affordances without forcing a load.
 */
export function isXXDKLoaded(): boolean {
  return initPromise !== null;
}
