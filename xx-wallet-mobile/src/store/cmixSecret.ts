/**
 * cMix messaging secret store.
 *
 * The device has ONE cMix EKV secret (one messaging identity per device). It is
 * protected by a DEDICATED messaging passphrase — deliberately separate from any
 * wallet-account password (see the go-online layer + SECURITY.md). Rationale: the
 * messaging identity is a self-contained, portable credential (it can be exported
 * and restored onto another device, or — later — into another cMix app), so its
 * protection is decoupled from the wallet's accounts.
 *
 * Lifecycle (orchestrated by the go-online layer, cmixOnline):
 *   - first time ever:   establish(passphrase)  → generates + wraps + returns the secret
 *   - later launches:    unlock(passphrase)      → unwraps + returns the secret
 *   - convenience:       a device-key wrap ("stay enabled on this device") lets a
 *                        future session skip the passphrase (see deviceKey).
 *
 * Persists only the wrapped blobs (base64), which are JSON-safe. The raw secret is
 * never persisted in the clear and never enters this store's state — callers hold
 * it transiently for the session.
 *
 * NOTE: reset() forgets the wraps only. Fully starting a NEW identity also means a
 * fresh cMix EKV; the new passphrase model uses its own storage dir (see
 * session.ts), so a clean establish() always builds a fresh store regardless of
 * any orphaned older state.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateStorageSecret, unwrapSecret, wrapSecret } from '@/cmix/storageSecret';

/** Minimum messaging-passphrase length. Low floor — this gates a comms identity,
 *  not funds; the UI explains the trade-off. Mirrored in the setup UI. */
export const MIN_PASSPHRASE_LEN = 8;

interface CmixSecretState {
  /** The device secret wrapped under the messaging passphrase (base64), or null
   *  if messaging has never been set up on this device. Ciphertext — safe to
   *  persist. */
  wrap: string | null;
  /** The SAME device secret wrapped under the device-bound key (base64), when
   *  "stay enabled on this device" is on; null when off. Ciphertext, so safe to
   *  persist. The key itself lives non-extractable in IndexedDB (see deviceKey). */
  deviceWrap: string | null;
  /** Wallet accounts that have a messaging identity on this device (i.e. you've
   *  gone online or shared a contact as them). On go-online each one's identity
   *  is logged in so it can receive — see the messaging layer + receive hook. */
  identityAccounts: string[];

  /** Whether a device secret has been established (a passphrase is set). */
  hasSecret(): boolean;

  /** Record that `account` now has a messaging identity (idempotent). */
  addIdentityAccount(account: string): void;

  /** First-time setup: generate a device secret, wrap it under the messaging
   *  passphrase, persist, and return the raw secret. Throws if a secret already
   *  exists (use unlock), or if the passphrase is shorter than the minimum. */
  establish(passphrase: string): Promise<Uint8Array>;

  /** Adopt an EXISTING device secret (e.g. when restoring an imported identity)
   *  under the messaging passphrase. Wraps + persists the in-hand secret. Throws
   *  on a too-short passphrase. */
  adopt(secret: Uint8Array, passphrase: string): Promise<void>;

  /** Unwrap the device secret with the messaging passphrase. Throws (from
   *  unwrapSecret) if the passphrase is wrong, or if no secret is set. */
  unlock(passphrase: string): Promise<Uint8Array>;

  /** Set or clear the device-key-wrapped secret (the "stay enabled" state). */
  setDeviceWrap(blob: string | null): void;

  /** Forget all wraps (passphrase AND device). The next establish() will mint a
   *  new device secret. */
  reset(): void;
}

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < MIN_PASSPHRASE_LEN) {
    throw new Error(`Messaging passphrase must be at least ${MIN_PASSPHRASE_LEN} characters.`);
  }
}

export const useCmixSecretStore = create<CmixSecretState>()(
  persist(
    (set, get) => ({
      wrap: null,
      deviceWrap: null,
      identityAccounts: [],

      hasSecret() {
        return get().wrap !== null;
      },

      addIdentityAccount(account) {
        if (!get().identityAccounts.includes(account)) {
          set({ identityAccounts: [...get().identityAccounts, account] });
        }
      },

      async establish(passphrase) {
        if (get().hasSecret()) {
          throw new Error('A messaging passphrase is already set on this device.');
        }
        assertPassphrase(passphrase);
        const secret = generateStorageSecret();
        const wrapped = await wrapSecret(secret, passphrase);
        set({ wrap: wrapped });
        return secret;
      },

      async adopt(secret, passphrase) {
        assertPassphrase(passphrase);
        const wrapped = await wrapSecret(secret, passphrase);
        set({ wrap: wrapped });
      },

      async unlock(passphrase) {
        const wrapped = get().wrap;
        if (!wrapped) {
          throw new Error('Messaging is not set up on this device yet.');
        }
        return unwrapSecret(wrapped, passphrase);
      },

      setDeviceWrap(blob) {
        set({ deviceWrap: blob });
      },

      reset() {
        set({ wrap: null, deviceWrap: null, identityAccounts: [] });
      },
    }),
    {
      // New key (was 'xx-wallet:cmix-secret'). The old model wrapped the secret
      // per wallet-account password and its device-wrap pointed at the old
      // storage dir — neither is usable here, and we can't convert them (no
      // account password to unwrap with). A fresh key means every device starts
      // clean: wrap=null ⇒ the user sets a dedicated messaging passphrase on
      // first go-online, minting a fresh identity in the new dir. The old
      // localStorage entry is left orphaned (tiny + harmless).
      name: 'xx-wallet:cmix-secret-v2',
      version: 1,
    }
  )
);
