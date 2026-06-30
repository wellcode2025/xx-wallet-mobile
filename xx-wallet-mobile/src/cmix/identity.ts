/**
 * The wallet's cMix reception identity.
 *
 * Created once and persisted in the cMix EKV (which itself persists in IndexedDB
 * via the session's stable storage dir), then reused on every launch — so the
 * same messaging identity survives restarts. By default it's generated on this
 * device (xxDK exposes no way to derive an identity from a seed, so we generate +
 * persist). It is NOT locked to one device, though: it's a portable credential
 * that can be exported (encrypted) and RESTORED onto another device so the user
 * stays reachable as the same contact after migrating — see `identityExport` and
 * the `importIdentity` path below.
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
 *
 * RESTORE: when `importIdentity` is given (a backup decrypted on this device),
 * persist + use THOSE bytes instead — so this device becomes the SAME messaging
 * party (same reception ID) as the device the backup came from. Overwrites any
 * identity already stored under the key, so a restore is decisive.
 */
export async function ensureReceptionIdentity(
  cmix: CMix,
  importIdentity?: Uint8Array
): Promise<Uint8Array> {
  const globals = getE2eGlobals();
  const cmixId = cmix.GetID();

  if (importIdentity && importIdentity.length > 0) {
    try {
      globals.StoreReceptionIdentity(IDENTITY_KEY, importIdentity, cmixId);
    } catch {
      // Best-effort persistence: Login still works from the in-hand bytes this
      // session; a later launch would re-load whatever is stored.
    }
    return importIdentity;
  }

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
