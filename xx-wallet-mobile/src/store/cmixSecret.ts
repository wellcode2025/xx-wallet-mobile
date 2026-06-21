/**
 * cMix messaging secret store.
 *
 * The device has ONE cMix EKV secret (one messaging identity per device). Under
 * the chosen multi-account model it is stored wrapped under EACH account the
 * user enables for messaging, so any of those accounts can bring messaging
 * online by unlocking — the wraps all encrypt the identical secret.
 *
 * Lifecycle (orchestrated by the go-online layer, C3c):
 *   - first time ever:        establish(account, password)  → generates + wraps + returns the secret
 *   - later, enabled account: unlock(account, password)      → unwraps + returns the secret
 *   - add another account:    addAccount(account, password, secret)  → wrap the in-hand secret (done while online)
 *
 * Persists only the wrapped blobs (account → base64), which are JSON-safe. The
 * raw secret is never persisted in the clear and never enters this store's
 * state — callers hold it transiently for the session.
 *
 * NOTE: reset() forgets the wraps only. Fully starting a NEW identity also means
 * clearing the cMix EKV (IndexedDB) so a fresh establish() builds a new one —
 * that's a session-layer concern, handled where the session is torn down.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateStorageSecret, unwrapSecret, wrapSecret } from '@/cmix/storageSecret';

interface CmixSecretState {
  /** account SS58 → base64 wrapped device secret. All entries wrap the same secret. */
  wraps: Record<string, string>;

  /** Whether a device secret has been established (any account is enabled). */
  hasSecret(): boolean;
  /** Whether this account can bring messaging online. */
  isEnabledFor(account: string): boolean;
  /** Accounts that can bring messaging online. */
  enabledAccounts(): string[];

  /** First-time setup: generate a device secret, wrap it under this account,
   *  persist, and return the raw secret. Throws if a secret already exists
   *  (use unlock for an enabled account, or addAccount to extend the set). */
  establish(account: string, password: string): Promise<Uint8Array>;

  /** Unwrap the device secret using an already-enabled account. Throws if the
   *  account isn't enabled, or (from unwrapSecret) if the password is wrong. */
  unlock(account: string, password: string): Promise<Uint8Array>;

  /** Extend the enabled set: wrap the (already in-hand) raw secret under another
   *  account's password. Done while online, when the secret is available. */
  addAccount(account: string, password: string, secret: Uint8Array): Promise<void>;

  /** Drop one account's wrap — it can no longer bring messaging online. */
  disableFor(account: string): void;

  /** Forget all wraps. The next establish() will mint a new device secret. */
  reset(): void;
}

export const useCmixSecretStore = create<CmixSecretState>()(
  persist(
    (set, get) => ({
      wraps: {},

      hasSecret() {
        return Object.keys(get().wraps).length > 0;
      },

      isEnabledFor(account) {
        return Boolean(get().wraps[account]);
      },

      enabledAccounts() {
        return Object.keys(get().wraps);
      },

      async establish(account, password) {
        if (get().hasSecret()) {
          throw new Error('A messaging secret already exists on this device.');
        }
        const secret = generateStorageSecret();
        const wrapped = await wrapSecret(secret, password);
        set({ wraps: { ...get().wraps, [account]: wrapped } });
        return secret;
      },

      async unlock(account, password) {
        const wrapped = get().wraps[account];
        if (!wrapped) {
          throw new Error('This account is not enabled for messaging.');
        }
        return unwrapSecret(wrapped, password);
      },

      async addAccount(account, password, secret) {
        const wrapped = await wrapSecret(secret, password);
        set({ wraps: { ...get().wraps, [account]: wrapped } });
      },

      disableFor(account) {
        const next = { ...get().wraps };
        delete next[account];
        set({ wraps: next });
      },

      reset() {
        set({ wraps: {} });
      },
    }),
    {
      name: 'xx-wallet:cmix-secret',
      version: 1,
    }
  )
);
