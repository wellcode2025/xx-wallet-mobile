/**
 * useAddressName — resolve any xx address to a human-readable name +
 * truncated fragment, by looking it up across the user's local stores.
 *
 * Lookup order:
 *   1. Own wallet accounts (by exact address match) — labeled 'self'
 *   2. Address book contacts — labeled 'contact'
 *   3. Known multisigs (by their derived address) — labeled 'multisig'
 *   4. Otherwise → null name, just the truncated fragment
 *
 * Per design doc §7.3, consumers MUST display the address fragment
 * alongside the name. We never substitute the name alone; that would
 * let a typo or a malicious imported config hide the actual address
 * behind a familiar-looking label. The AddressLabel component enforces
 * this pairing; this hook just supplies the data.
 *
 * Returned fragment is the same shortened form `shortenAddress`
 * produces (5+4 chars by default) so it's compact enough to fit
 * inline alongside the name without wrapping.
 */

import { useMemo } from 'react';
import {
  useAccountsStore,
  useAddressBook,
  useMultisigsStore,
} from '@/store';
import { shortenAddress } from '@/utils/address';

export type AddressNameSource = 'self' | 'contact' | 'multisig' | null;

export interface AddressName {
  /** Human-readable name if we found a match; null otherwise. The
   *  caller renders the address fragment when name is null. */
  name: string | null;
  /** Truncated SS58 form. Always present (even when name is non-null). */
  fragment: string;
  /** Where the name came from, in case the consumer wants to render
   *  a small badge or style differently per source. */
  source: AddressNameSource;
}

export function useAddressName(
  address: string | null | undefined
): AddressName {
  const accounts = useAccountsStore((s) => s.accounts);
  const contacts = useAddressBook((s) => s.contacts);
  const multisigs = useMultisigsStore((s) => s.multisigs);

  return useMemo(() => {
    if (!address) {
      return { name: null, fragment: '', source: null };
    }
    const fragment = shortenAddress(address);

    // Own wallet accounts first — anything in the user's keyring takes
    // precedence over external labels.
    const own = accounts.find((a) => a.address === address);
    if (own) {
      return { name: own.name, fragment, source: 'self' };
    }

    // Then address book — but only if the contact has a non-empty
    // name. Address-book entries can exist with empty names (imports
    // skip auto-add for unlabeled signers, but the user may
    // have added an unnamed contact some other way).
    const contact = contacts.find((c) => c.address === address);
    if (contact && contact.name.trim().length > 0) {
      return { name: contact.name, fragment, source: 'contact' };
    }

    // Then known multisigs — useful when an address turns out to be
    // a multisig the user has in their wallet (e.g., the multisig
    // appears in a transfer as a destination).
    const multisig = multisigs.find((m) => m.address === address);
    if (multisig) {
      return { name: multisig.localName, fragment, source: 'multisig' };
    }

    return { name: null, fragment, source: null };
  }, [address, accounts, contacts, multisigs]);
}
