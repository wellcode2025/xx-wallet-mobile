/**
 * Contact registry — the per-account set of verified cMix device-contacts that
 * makes account-addressed fan-out work.
 *
 * Keyed by wallet account (SS58); each entry is that account's
 * signature-verified device contacts (one per device the account runs). To send
 * to a cosigner you look up `contactsForAccount` and fan out to every device;
 * for a whole multisig you union the cosigners' contacts with
 * `contactsForAccounts`. Offline devices in the set still pick up on reconnect.
 *
 * SECURITY: `addBinding` verifies the binding SIGNATURE (the account key really
 * signed this contact) — but it does NOT decide whether you should trust that
 * account. Authorization ("is this account a cosigner I expect?") is the
 * caller's responsibility; only feed bindings for accounts you already know.
 *
 * All operations are pure and never mutate the input registry, so it drops
 * straight into a store with structural updates.
 */
import { verifyContactBinding, type SignedContactBinding } from './contactBinding';

export interface ContactRegistry {
  /** account SS58 → its verified device-contact bindings. */
  byAccount: Record<string, SignedContactBinding[]>;
}

export function emptyRegistry(): ContactRegistry {
  return { byAccount: {} };
}

export type AddBindingResult =
  | { ok: true; registry: ContactRegistry; added: boolean }
  | { ok: false; reason: string };

/**
 * Verify a binding and, if valid and new, return a registry with it added.
 * `added` is false when the same contact is already registered for the account
 * (an idempotent re-announce). Never mutates the input registry.
 */
export function addBinding(registry: ContactRegistry, binding: SignedContactBinding): AddBindingResult {
  if (!verifyContactBinding(binding)) {
    return { ok: false, reason: 'contact binding signature does not verify' };
  }
  const existing = registry.byAccount[binding.account] ?? [];
  if (existing.some((b) => sameBytes(b.cMixContact, binding.cMixContact))) {
    return { ok: true, registry, added: false };
  }
  return {
    ok: true,
    added: true,
    registry: {
      byAccount: { ...registry.byAccount, [binding.account]: [...existing, binding] },
    },
  };
}

/** The cMix contacts bound to a single account (one per device). */
export function contactsForAccount(registry: ContactRegistry, account: string): Uint8Array[] {
  return (registry.byAccount[account] ?? []).map((b) => b.cMixContact);
}

/**
 * The union of device-contacts across several accounts — the fan-out target for
 * a whole multisig's cosigners. Deduplicated by contact bytes.
 */
export function contactsForAccounts(registry: ContactRegistry, accounts: string[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const account of accounts) {
    for (const contact of contactsForAccount(registry, account)) {
      if (!out.some((c) => sameBytes(c, contact))) out.push(contact);
    }
  }
  return out;
}

/** Remove a single device-contact from an account (revoke a lost or retired device). */
export function removeContact(
  registry: ContactRegistry,
  account: string,
  contact: Uint8Array
): ContactRegistry {
  const existing = registry.byAccount[account];
  if (!existing) return registry;
  const remaining = existing.filter((b) => !sameBytes(b.cMixContact, contact));
  const byAccount = { ...registry.byAccount };
  if (remaining.length === 0) delete byAccount[account];
  else byAccount[account] = remaining;
  return { byAccount };
}

/** Accounts that have at least one registered device-contact. */
export function knownAccounts(registry: ContactRegistry): string[] {
  return Object.keys(registry.byAccount);
}

/**
 * Whether `contact` belongs to any registered account, comparing on cMix
 * IDENTITY via the injected `sameIdentity` predicate.
 *
 * We deliberately do NOT raw-byte-compare: the same identity marshals to
 * different bytes across forms (a channel request carries an ownership proof
 * that GetContact() lacks), so a byte-match would reject a legitimate cosigner.
 * The caller supplies `sameIdentity` — in production, equality of the reception
 * IDs extracted with `getIDFromContact` — keeping this module free of any wasm
 * dependency and trivially testable with a stub comparator.
 *
 * SECURITY: this answers "is the requester one of my known cosigners?" so we
 * only auto-confirm channel requests from accounts already in the registry. The
 * predicate should compare canonical identities; a loose predicate would widen
 * who we auto-accept.
 */
export function isKnownContact(
  registry: ContactRegistry,
  contact: Uint8Array,
  sameIdentity: (a: Uint8Array, b: Uint8Array) => boolean
): boolean {
  for (const bindings of Object.values(registry.byAccount)) {
    for (const b of bindings) {
      if (sameIdentity(b.cMixContact, contact)) return true;
    }
  }
  return false;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
