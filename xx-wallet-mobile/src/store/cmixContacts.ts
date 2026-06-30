/**
 * cMix contacts store — the persisted home of the contact registry.
 *
 * Keyed by ACCOUNT, not by multisig: a cosigner's account-signed device
 * contacts are the same wherever that account is a signer, so they live in one
 * account-keyed registry rather than being duplicated onto each MultisigSigner.
 * To find a multisig's reachable cosigners, look its signer addresses up here
 * with `contactsForAccounts`.
 *
 * State is held in the JSON-safe serialized form (bindings carry Uint8Arrays);
 * the in-memory ContactRegistry is rebuilt on demand for reads. `addBinding`
 * always re-verifies the signature before anything is stored — so an unverified
 * or impostor binding never enters the store.
 *
 * SECURITY: a verified signature proves the account holder authored the binding;
 * it does NOT decide whether you trust that account. Callers must only feed
 * bindings for accounts they already expect (e.g. a multisig's signer set).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  addBinding as addToRegistry,
  contactsForAccount as registryContactsForAccount,
  contactsForAccounts as registryContactsForAccounts,
  isKnownContact as registryIsKnownContact,
  knownAccounts as registryKnownAccounts,
  removeContact as registryRemoveContact,
} from '@/cmix/contactRegistry';
import { deserializeRegistry, serializeRegistry, type SerializedRegistry } from '@/cmix/registrySerde';
import type { SignedContactBinding } from '@/cmix/contactBinding';

interface CmixContactsState {
  /** account SS58 → serialized SignedContactBinding strings. JSON-safe. */
  bindings: SerializedRegistry;

  /** Verify and store a binding. Returns false (and stores nothing) if the
   *  signature doesn't verify. Idempotent on a repeat of the same contact. */
  addBinding(binding: SignedContactBinding): boolean;
  /** Remove one device-contact for an account (revoke a lost/retired device). */
  removeContact(account: string, contact: Uint8Array): void;
  /** Forget ALL of an account's device-contacts (remove the whole partner). */
  forgetAccount(account: string): void;
  /** cMix contacts bound to a single account (one per device). */
  contactsForAccount(account: string): Uint8Array[];
  /** Union of device-contacts across accounts — a multisig's fan-out target. */
  contactsForAccounts(accounts: string[]): Uint8Array[];
  /** Accounts with at least one registered device-contact. */
  knownAccounts(): string[];
  /** Whether `contact` belongs to a registered cosigner — used to auto-confirm
   *  only known partners' channel requests. `sameIdentity` compares cMix
   *  identities (reception IDs), injected so this store stays wasm-free. */
  isKnownContact(contact: Uint8Array, sameIdentity: (a: Uint8Array, b: Uint8Array) => boolean): boolean;
}

export const useCmixContactsStore = create<CmixContactsState>()(
  persist(
    (set, get) => ({
      bindings: {},

      addBinding(binding) {
        const result = addToRegistry(deserializeRegistry(get().bindings), binding);
        if (!result.ok) return false;
        if (result.added) set({ bindings: serializeRegistry(result.registry) });
        return true;
      },

      removeContact(account, contact) {
        const next = registryRemoveContact(deserializeRegistry(get().bindings), account, contact);
        set({ bindings: serializeRegistry(next) });
      },

      forgetAccount(account) {
        const next = { ...get().bindings };
        delete next[account];
        set({ bindings: next });
      },

      contactsForAccount(account) {
        return registryContactsForAccount(deserializeRegistry(get().bindings), account);
      },

      contactsForAccounts(accounts) {
        return registryContactsForAccounts(deserializeRegistry(get().bindings), accounts);
      },

      knownAccounts() {
        return registryKnownAccounts(deserializeRegistry(get().bindings));
      },

      isKnownContact(contact, sameIdentity) {
        return registryIsKnownContact(deserializeRegistry(get().bindings), contact, sameIdentity);
      },
    }),
    {
      name: 'xx-wallet:cmix-contacts',
      version: 1,
    }
  )
);
