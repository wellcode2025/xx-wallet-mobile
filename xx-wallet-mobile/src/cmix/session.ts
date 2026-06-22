/**
 * The wallet's persistent cMix session.
 *
 * One cMix client, created once and reused for the app's lifetime — the same
 * "init once, reuse" rule the private-indexer design and the spikes settled on
 * (initialising per operation would cost the minutes-long warmup every time).
 * Built on the proven spike flow: NewCmix (first launch only) → LoadCmix →
 * StartNetworkFollower → WaitForNetwork, with follower-health tracking.
 *
 * WARM RESUME — the single biggest performance lever (build plan A2). The cMix
 * state, including the registered-node keys, persists in IndexedDB under a
 * STABLE storage directory. On a later launch we skip NewCmix and LoadCmix the
 * existing state, so the follower reaches healthy far faster than a cold first
 * run (it already holds node-registration keys). Spikes measured the cold
 * follower warmup at 15–140 s and highly variable; persistence is what cuts it.
 *
 * This module is the cMix/follower layer only. The reception identity + Login +
 * the e2e handshake/send/receive live in a separate layer that builds on the
 * `cmix` object exposed here.
 */
import type { CMix, XXDKUtils } from 'xxdk-wasm';
import { loadXXDK, type LoadXXDKOptions } from './load';
import type { ConnectPhase } from './phases';

/** Stable storage dir so the cMix state (and node keys) persist across launches. */
const DEFAULT_STORAGE_DIR = 'xx-wallet-cmix';
/** StartNetworkFollower's internal poll timeout (the spike-proven value). */
const FOLLOWER_POLL_MS = 5000;
/** Default ceiling for the follower to reach healthy (mobile cold start can be long). */
const DEFAULT_HEALTHY_TIMEOUT_MS = 300_000;

export interface CmixSession {
  /** The live cMix client. */
  readonly cmix: CMix;
  /** True once the network follower has reported a healthy state. */
  isHealthy(): boolean;
  /** Subscribe to follower-health changes. Returns an unsubscribe function. */
  onHealth(cb: (healthy: boolean) => void): () => void;
  /** Stop the follower (e.g. on backgrounding, to save battery/data). */
  stop(): void;
}

export interface CmixSessionOptions {
  /**
   * Password that encrypts the cMix EKV state at rest in IndexedDB. The caller
   * (wallet identity layer) supplies it; this module never derives or stores it.
   */
  storagePassword: Uint8Array;
  /** Stable storage directory. Defaults to a fixed per-app dir for warm resume. */
  storageDir?: string;
  /** Max time to wait for the follower to reach healthy. */
  healthyTimeoutMs?: number;
  /** Forwarded to the lazy xxDK loader (e.g. a self-hosted base path, or a test stub). */
  load?: LoadXXDKOptions;
  /** Fired as each connect phase begins, so the UI can show real progress. */
  onPhase?: (phase: ConnectPhase) => void;
}

let sessionPromise: Promise<CmixSession> | null = null;

/**
 * Get the singleton cMix session, building + connecting it on first call and
 * returning the same live session thereafter. On failure the cache is cleared
 * so a later call retries cleanly (matches `loadXXDK` / `initSleeve`).
 */
export function getCmixSession(opts: CmixSessionOptions): Promise<CmixSession> {
  if (!sessionPromise) {
    sessionPromise = buildSession(opts).catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

/** Whether a session has been started (or is starting) in this app lifetime. */
export function hasCmixSession(): boolean {
  return sessionPromise !== null;
}

async function buildSession(opts: CmixSessionOptions): Promise<CmixSession> {
  opts.onPhase?.('loading');
  const { utils, getDefaultNDF } = await loadXXDK(opts.load);
  const dir = opts.storageDir ?? DEFAULT_STORAGE_DIR;
  const params = buildCmixParams(utils.GetDefaultCMixParams());

  opts.onPhase?.('opening');
  const cmix = await loadOrInitCmix(utils, getDefaultNDF, dir, opts.storagePassword, params);

  const health = new HealthTracker();
  try {
    cmix.AddHealthCallback({ Callback: (h) => health.set(h) });
  } catch {
    // Health callbacks are best-effort; WaitForNetwork below is the real gate.
  }

  opts.onPhase?.('connecting');
  cmix.StartNetworkFollower(FOLLOWER_POLL_MS);
  await cmix.WaitForNetwork(opts.healthyTimeoutMs ?? DEFAULT_HEALTHY_TIMEOUT_MS);
  health.set(true);

  return {
    cmix,
    isHealthy: () => health.healthy,
    onHealth: (cb) => health.subscribe(cb),
    stop: () => {
      try {
        cmix.StopNetworkFollower();
      } catch {
        // already stopped — fine
      }
      health.set(false);
    },
  };
}

/**
 * Load the persisted cMix state, creating it once on the very first launch.
 * Self-correcting: if LoadCmix fails because no state exists yet, run NewCmix
 * then LoadCmix. On every later launch LoadCmix succeeds directly — the
 * warm-resume path that reuses the persisted node-registration keys.
 */
async function loadOrInitCmix(
  utils: XXDKUtils,
  getDefaultNDF: () => string,
  dir: string,
  password: Uint8Array,
  params: Uint8Array
): Promise<CMix> {
  try {
    return await utils.LoadCmix(dir, password, params);
  } catch {
    // No existing state (first launch). Create a fresh identity, then load it.
    // A registration code is not used (empty string), matching the spike.
    await utils.NewCmix(getDefaultNDF(), dir, password, '');
    return await utils.LoadCmix(dir, password, params);
  }
}

/**
 * Patch the default cMix params to enable immediate sending (the spike-proven
 * setting). Pure: takes and returns the JSON-encoded params bytes; falls back to
 * the unchanged defaults if the shape is unexpected rather than breaking startup.
 * Exported for unit testing.
 */
export function buildCmixParams(defaultParams: Uint8Array): Uint8Array {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(defaultParams));
    if (parsed && parsed.Network) {
      parsed.Network.EnableImmediateSending = true;
      return new TextEncoder().encode(JSON.stringify(parsed));
    }
  } catch {
    // Malformed — fall through and use the defaults unchanged.
  }
  return defaultParams;
}

/**
 * Minimal follower-health tracker: holds the current state and notifies
 * subscribers on change (deduping repeats). Pure logic; exported for tests.
 */
export class HealthTracker {
  private _healthy = false;
  private readonly subs = new Set<(healthy: boolean) => void>();

  get healthy(): boolean {
    return this._healthy;
  }

  set(healthy: boolean): void {
    const next = !!healthy;
    if (next === this._healthy) return;
    this._healthy = next;
    for (const cb of this.subs) cb(next);
  }

  subscribe(cb: (healthy: boolean) => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }
}
