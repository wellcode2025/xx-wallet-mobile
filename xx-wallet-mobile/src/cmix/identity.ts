/**
 * The wallet's cMix reception identities — ONE PER WALLET ACCOUNT.
 *
 * Each account you message as has its own reception identity (its own cMix
 * reception ID), so your accounts are unlinkable to peers: account X's chats
 * can't be tied to account Y's. All of them live in the same cMix EKV (one
 * client / one network follower hosts every identity — proven viable), each
 * under an account-namespaced key, and each is created on first use + reused on
 * every launch. xxDK exposes no way to derive an identity from a seed, so we
 * generate + persist.
 *
 * Each is a portable credential: it can be exported (encrypted) and RESTORED onto
 * another device so that account stays reachable as the same contact after
 * migrating — see `identityExport` and the `importIdentity` path below.
 */
import type { CMix } from 'xxdk-wasm';
import { asE2eCmix, getE2eGlobals } from './e2eApi';

/** EKV key prefix; the per-account identity is stored under `${PREFIX}:${account}`. */
const IDENTITY_KEY_PREFIX = 'xx-wallet-e2e-identity';

/** The EKV key for a given account's reception identity. */
function identityKey(account: string): string {
  return `${IDENTITY_KEY_PREFIX}:${account}`;
}

/**
 * Load the persisted reception identity for `account`, creating + storing it on
 * first use. Returns the marshalled identity bytes to pass to `Login`.
 * Self-correcting: if none is stored yet for this account, make one and store it;
 * on every later launch the load succeeds and the same identity is reused.
 *
 * RESTORE: when `importIdentity` is given (a backup decrypted on this device),
 * persist + use THOSE bytes instead — so this device becomes the SAME messaging
 * party (same reception ID) for that account as the device the backup came from.
 * Overwrites any identity already stored under the account's key.
 */
export async function ensureReceptionIdentity(
  cmix: CMix,
  account: string,
  importIdentity?: Uint8Array
): Promise<Uint8Array> {
  const globals = getE2eGlobals();
  const cmixId = cmix.GetID();
  const key = identityKey(account);

  if (importIdentity && importIdentity.length > 0) {
    try {
      globals.StoreReceptionIdentity(key, importIdentity, cmixId);
    } catch {
      // Best-effort persistence: Login still works from the in-hand bytes this
      // session; a later launch would re-load whatever is stored.
    }
    return importIdentity;
  }

  try {
    return globals.LoadReceptionIdentity(key, cmixId);
  } catch {
    // No stored identity yet for this account. Make + persist one.
    const identity = await asE2eCmix(cmix).MakeReceptionIdentity();
    try {
      globals.StoreReceptionIdentity(key, identity, cmixId);
    } catch {
      // Persistence is best-effort: the identity still works for this session
      // even if storing fails; it would just be regenerated next launch.
    }
    return identity;
  }
}
