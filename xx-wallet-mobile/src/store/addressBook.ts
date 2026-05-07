/**
 * Address book store.
 *
 * Stores named contacts (label + xx address) that persist across sessions.
 * These are separate from wallet accounts — they are external addresses
 * the user sends to frequently, like a contacts list in a messaging app.
 *
 * Contacts can optionally be enriched with on-chain identity data (display
 * name, email, twitter, etc.) fetched from the xx network identity pallet.
 * Identity data is cached in the contact record and only refreshed on
 * explicit user action ("Sync identities" button), never automatically.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * On-chain identity data, as returned by the identity pallet.
 * All fields are optional because on-chain identities can set or omit any subset.
 */
export interface OnChainIdentity {
  display?: string;
  legal?: string;
  email?: string;
  web?: string;
  twitter?: string;
  riot?: string;
  /** One of: Unknown, FeePaid, Reasonable, KnownGood, OutOfDate, LowQuality, Erroneous */
  judgement?: string;
  /** Timestamp when the identity was last fetched from chain */
  fetchedAt: number;
}

export interface Contact {
  id: string;
  /** User-defined name. Optional — may be empty. */
  name: string;
  address: string;
  /** Optional note, e.g. "exchange deposit", "cold storage" */
  note?: string;
  /** Cached on-chain identity, if any. Fetched on-demand, never auto-refreshed. */
  identity?: OnChainIdentity | null;
  createdAt: number;
}

interface AddressBookState {
  contacts: Contact[];
  addContact(address: string, name?: string, note?: string): Contact;
  updateContact(
    id: string,
    updates: Partial<Pick<Contact, 'name' | 'address' | 'note' | 'identity'>>
  ): void;
  removeContact(id: string): void;
  /** Replace a contact's cached identity (after sync) */
  setIdentity(id: string, identity: OnChainIdentity | null): void;
  /** Import contacts from a JSON payload. Returns count of added / skipped */
  importContacts(json: unknown): { added: number; skipped: number; errors: number };
  /** Export contacts as a plain JSON-serializable array */
  exportContacts(): ExportedContact[];
}

/** Format used for import/export — kept minimal for cross-wallet compatibility */
export interface ExportedContact {
  name: string;
  address: string;
  note?: string;
}

export const useAddressBook = create<AddressBookState>()(
  persist(
    (set, get) => ({
      contacts: [],

      addContact(address, name = '', note) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const contact: Contact = {
          id,
          name,
          address,
          note,
          createdAt: Date.now(),
          identity: null,
        };
        set({ contacts: [...get().contacts, contact] });
        return contact;
      },

      updateContact(id, updates) {
        set({
          contacts: get().contacts.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          ),
        });
      },

      removeContact(id) {
        set({ contacts: get().contacts.filter((c) => c.id !== id) });
      },

      setIdentity(id, identity) {
        set({
          contacts: get().contacts.map((c) =>
            c.id === id ? { ...c, identity } : c
          ),
        });
      },

      importContacts(json) {
        const existing = get().contacts;
        const existingAddresses = new Set(existing.map((c) => c.address));
        let added = 0;
        let skipped = 0;
        let errors = 0;

        // Accept either { contacts: [...] } or [...]
        const list: unknown[] = Array.isArray(json)
          ? json
          : Array.isArray((json as any)?.contacts)
          ? (json as any).contacts
          : [];

        const newContacts: Contact[] = [];
        for (const item of list) {
          if (!item || typeof item !== 'object') { errors++; continue; }
          const entry = item as Record<string, unknown>;
          const address = typeof entry.address === 'string' ? entry.address.trim() : '';
          if (!address) { errors++; continue; }
          if (existingAddresses.has(address)) { skipped++; continue; }

          const name = typeof entry.name === 'string' ? entry.name : '';
          const note = typeof entry.note === 'string' && entry.note ? entry.note : undefined;

          newContacts.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${added}`,
            name,
            address,
            note,
            createdAt: Date.now(),
            identity: null,
          });
          existingAddresses.add(address);
          added++;
        }

        if (newContacts.length > 0) {
          set({ contacts: [...existing, ...newContacts] });
        }
        return { added, skipped, errors };
      },

      exportContacts() {
        return get().contacts.map<ExportedContact>((c) => ({
          name: c.name,
          address: c.address,
          note: c.note,
        }));
      },
    }),
    { name: 'xx-wallet:address-book', version: 2 }
  )
);
