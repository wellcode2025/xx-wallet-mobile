/**
 * PendingProposalCache — local cache of call bytes for pending multisigs.
 *
 * Why this store exists:
 *
 * On xx network, pending multisig proposals only carry the call HASH on
 * chain — never the full call bytes.
 * To render a description of "what does this proposal do?" the wallet
 * needs the full bytes, which arrive out-of-band from one of two sources:
 *
 *   1. The user themselves proposed it, in which case the
 *      wallet held the bytes locally during construction. Cached so the
 *      user can re-share with cosigners later.
 *
 *   2. A cosigner shared bytes with the user via paste / file / QR /
 *      eventually the notification service. Cached so
 *      the user can navigate away and come back without losing them.
 *
 * Both paths persist into this store keyed by (multisigAddress, callHash).
 * The bytes are always hash-verified before being cached — see
 * `verifyCallHash` in utils/decodeCall.ts. We never store unverified
 * bytes here; if the bytes don't hash to the expected callHash, they
 * are not put.
 *
 * Storage size considerations: a transferKeepAlive call serializes to
 * roughly 100 bytes of hex (~200 chars). Even a hundred pending bytes
 * across a hundred multisigs is well under any reasonable localStorage
 * cap. This store's size is unbounded; entries are small enough that
 * this stays well within localStorage limits.
 *
 * This is the call-bytes cache half of the multisig data model (the other
 * half being the known-multisigs store). The approval flow decodes from
 * these cached bytes and hash-gates against the chain — never trusting
 * depositor-supplied text.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PendingBytesEntry {
  /** Multisig account this proposal is at. */
  multisigAddress: string;
  /** On-chain call hash (0x-prefixed, lowercased). */
  callHash: string;
  /** Canonical-form hex of the call bytes (0x-prefixed, lowercased).
   *  Always hash-verified against `callHash` before being put here. */
  callBytes: string;
  /** Where these bytes came from — informational, used by the UI to
   *  surface the right messaging ("you proposed this" vs "received
   *  from cosigner"). */
  source: 'self-proposed' | 'received';
  /** When the bytes were first cached locally (Unix ms). */
  receivedAt: number;
}

interface PendingBytesState {
  /** Map keyed by `${multisigAddress}::${callHash}`. Stored as a record
   *  for clean JSON serialization in localStorage. */
  entries: Record<string, PendingBytesEntry>;

  /** Insert or replace an entry. Callers MUST hash-verify before calling
   *  this — see SECURITY note above. The store does not re-verify;
   *  doing so here would couple it to the api/registry. */
  putBytes(entry: PendingBytesEntry): void;

  /** Look up bytes for a specific (multisig, hash) pair. Returns
   *  undefined if not cached. */
  getBytes(
    multisigAddress: string,
    callHash: string
  ): PendingBytesEntry | undefined;

  /** Remove a specific entry — typically called after the proposal has
   *  executed or been cancelled, since the bytes are no longer needed. */
  removeBytes(multisigAddress: string, callHash: string): void;

  /** List all cached entries for a single multisig. */
  listForMultisig(multisigAddress: string): PendingBytesEntry[];

  /** All cached entries (used by the cross-multisig pending list in the
   *  account dropdown). */
  listAll(): PendingBytesEntry[];

  /** Wipe the entire cache. Reserved for testing / reset; production
   *  callers should use removeBytes for individual entries. */
  clearAll(): void;
}

const keyOf = (multisigAddress: string, callHash: string): string =>
  `${multisigAddress}::${callHash.toLowerCase()}`;

export const usePendingBytesStore = create<PendingBytesState>()(
  persist(
    (set, get) => ({
      entries: {},

      putBytes(entry) {
        const k = keyOf(entry.multisigAddress, entry.callHash);
        set({
          entries: {
            ...get().entries,
            [k]: {
              ...entry,
              callHash: entry.callHash.toLowerCase(),
              callBytes: entry.callBytes.toLowerCase(),
            },
          },
        });
      },

      getBytes(multisigAddress, callHash) {
        return get().entries[keyOf(multisigAddress, callHash)];
      },

      removeBytes(multisigAddress, callHash) {
        const k = keyOf(multisigAddress, callHash);
        const { [k]: _removed, ...rest } = get().entries;
        set({ entries: rest });
      },

      listForMultisig(multisigAddress) {
        return Object.values(get().entries).filter(
          (e) => e.multisigAddress === multisigAddress
        );
      },

      listAll() {
        return Object.values(get().entries);
      },

      clearAll() {
        set({ entries: {} });
      },
    }),
    {
      name: 'xx-wallet:pending-bytes',
      version: 1,
    }
  )
);
