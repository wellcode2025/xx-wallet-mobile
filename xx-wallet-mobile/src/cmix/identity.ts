/**
 * The wallet's per-device cMix reception identity.
 *
 * Created once and persisted in the cMix EKV (which itself persists in
 * IndexedDB via the session's stable storage dir), then reused on every launch
 * — so the same messaging identity survives restarts. Per-device is the correct
 * model here: each device is a distinct messaging party (and a distinct cosigner
 * in the multisig case), so devices should NOT share an identity. xxDK exposes
 * no way to derive an identity from a seed, so we generate + persist instead.
 */
import type { CMix } from 'xxdk-wasm';
import { asE2eCmix, getE2eGlobals } from './e2eApi';

/** EKV key under which the reception identity is stored. */
const IDENTITY_KEY = 'xx-wallet-e2e-identity';

/**
 * Load the persisted reception identity, creating + storing it on first use.
 * Returns the marshalled identity bytes to pass to `Login`. Self-correcting: if
 * no identity is stored yet, make one and store it; on every later launch the
 * load succeeds and the same identity is reused.
 */
export async function ensureReceptionIdentity(cmix: CMix): Promise<Uint8Array> {
  const globals = getE2eGlobals();
  const cmixId = cmix.GetID();

  try {
    return globals.LoadReceptionIdentity(IDENTITY_KEY, cmixId);
  } catch {
    // No stored identity yet (first launch on this device). Make + persist one.
    const identity = await asE2eCmix(cmix).MakeReceptionIdentity();
    try {
      globals.StoreReceptionIdentity(IDENTITY_KEY, identity, cmixId);
    } catch {
      // Persistence is best-effort: the identity still works for this session
      // even if storing fails; it would just be regenerated next launch.
    }
    return identity;
  }
}
