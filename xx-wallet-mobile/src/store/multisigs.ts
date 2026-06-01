/**
 * Multisigs store.
 *
 * Holds the list of multisig accounts the user is part of. Unlike regular
 * accounts (which live in the keyring with private key material), a multisig
 * is just an *address derived from a (threshold, signers) tuple* — the
 * "account" has no private key of its own and never signs anything directly.
 * Every action originating from a multisig is a cosigner invoking
 * `pallet_multisig.as_multi` from their own (key-bearing) account.
 *
 * What we persist per multisig:
 *   - The (threshold, signers) tuple — the cryptographic primitive.
 *   - The derived address — recomputed locally on every load via
 *     deriveMultisigAddress(); we store it for fast lookups but it is
 *     never authoritative on its own.
 *   - A user-chosen local nickname.
 *   - The configHash (sha256 of the canonical JSON form) for dedup.
 *   - Per-signer optional local labels (separate from the address book).
 *
 * What we deliberately do NOT persist:
 *   - "What this multisig is for" — that's local note territory at most;
 *     we don't model a freeform description because it would invite
 *     depositor-asserted descriptions of pending proposals to leak in by
 *     analogy.
 *   - Cosigner identities authoritatively — the signer set IS the
 *     authoritative cosigner record, derived from the address parameters.
 *
 * This is the known-multisigs half of the multisig data model (the other
 * half being the cached call bytes for pending proposals).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  configHashOf,
  deriveMultisigAddress,
  multisigAddressMatches,
} from '@/utils/multisig';

/**
 * One signer in a multisig's signatory set. The `label` is local to this
 * wallet — different signers can label the same cosigner address differently
 * and the configHash is unaffected.
 */
export interface MultisigSigner {
  address: string;
  /** Optional local label, separate from the address book. May be empty. */
  label?: string;
}

export interface Multisig {
  /** SS58-encoded multisig address (xx prefix 55). Recomputed at save time
   *  from `deriveMultisigAddress(threshold, signers.map(s => s.address))`.
   *  Stored for fast lookup but NEVER trusted as authoritative — every
   *  consumer should re-derive locally before acting on it. */
  address: string;
  threshold: number;
  signers: MultisigSigner[];
  /** User-chosen local nickname. Mutable. */
  localName: string;
  /** sha256 of canonical {threshold, sortedSigners} JSON. Used to detect
   *  duplicate imports of the same configuration regardless of source. */
  configHash: string;
  importedAt: number;
  /** Updated by store consumers (e.g., the multisig detail screen) when
   *  they fetch fresh on-chain state for this multisig. Used to surface
   *  "last updated X ago" without touching the chain on every render. */
  lastSeenAt: number;
}

export interface AddMultisigInput {
  threshold: number;
  /** Signer addresses. Order doesn't affect derivation; canonicalized
   *  internally before storage. */
  signers: Array<string | MultisigSigner>;
  localName: string;
}

interface MultisigsState {
  multisigs: Multisig[];

  /** Add a new multisig. Throws if the (threshold, signers) tuple is
   *  invalid (per deriveMultisigAddress's checks) or if a multisig with
   *  the resulting address already exists. */
  addMultisig(input: AddMultisigInput): Promise<Multisig>;

  /** Update the local-only fields (nickname, per-signer labels). The
   *  cryptographic fields (threshold, signers, address, configHash) are
   *  immutable — to "edit" them, remove and re-add. */
  renameMultisig(address: string, newName: string): void;
  setSignerLabel(address: string, signerAddress: string, label: string): void;

  removeMultisig(address: string): void;

  /** Mark that we've just observed fresh on-chain state for this multisig. */
  touchLastSeen(address: string): void;

  /** Lookup helpers. */
  getMultisig(address: string): Multisig | undefined;
  /** Multisigs the given account is a signer of. */
  multisigsForSigner(signerAddress: string): Multisig[];
}

export const useMultisigsStore = create<MultisigsState>()(
  persist(
    (set, get) => ({
      multisigs: [],

      async addMultisig({ threshold, signers, localName }) {
        // Normalize signers to {address, label?} shape for storage.
        const normalizedSigners: MultisigSigner[] = signers.map((s) =>
          typeof s === 'string' ? { address: s } : { ...s }
        );
        const signerAddresses = normalizedSigners.map((s) => s.address);

        // Will throw on bad input (non-integer threshold, threshold > N,
        // <2 signers, invalid xx address). We let the throw propagate so
        // callers can surface validation errors to the UI.
        const address = deriveMultisigAddress(threshold, signerAddresses);

        // Belt-and-suspenders: even though we just derived it, verify the
        // claim. Also catches the (impossible-on-this-path-but-cheap-to-
        // check) scenario of a bug in deriveMultisigAddress.
        if (!multisigAddressMatches(address, threshold, signerAddresses)) {
          throw new Error(
            'Internal error: derived multisig address failed self-verification.'
          );
        }

        if (get().multisigs.some((m) => m.address === address)) {
          throw new Error(
            `A multisig with address ${address} is already in your wallet.`
          );
        }

        const configHash = await configHashOf(threshold, signerAddresses);
        const now = Date.now();
        const multisig: Multisig = {
          address,
          threshold,
          signers: normalizedSigners,
          localName: localName.trim() || 'Untitled multisig',
          configHash,
          importedAt: now,
          lastSeenAt: now,
        };

        set({ multisigs: [...get().multisigs, multisig] });
        return multisig;
      },

      renameMultisig(address, newName) {
        const trimmed = newName.trim() || 'Untitled multisig';
        set({
          multisigs: get().multisigs.map((m) =>
            m.address === address ? { ...m, localName: trimmed } : m
          ),
        });
      },

      setSignerLabel(address, signerAddress, label) {
        set({
          multisigs: get().multisigs.map((m) => {
            if (m.address !== address) return m;
            return {
              ...m,
              signers: m.signers.map((s) =>
                s.address === signerAddress ? { ...s, label } : s
              ),
            };
          }),
        });
      },

      removeMultisig(address) {
        set({
          multisigs: get().multisigs.filter((m) => m.address !== address),
        });
      },

      touchLastSeen(address) {
        const now = Date.now();
        set({
          multisigs: get().multisigs.map((m) =>
            m.address === address ? { ...m, lastSeenAt: now } : m
          ),
        });
      },

      getMultisig(address) {
        return get().multisigs.find((m) => m.address === address);
      },

      multisigsForSigner(signerAddress) {
        return get().multisigs.filter((m) =>
          m.signers.some((s) => s.address === signerAddress)
        );
      },
    }),
    {
      name: 'xx-wallet:multisigs',
      version: 1,
    }
  )
);
