/**
 * Tests for the contact registry.
 *
 * Covers the multi-device case the whole model exists for (two devices of one
 * account both registered, fan-out reaches all), impostor rejection, idempotent
 * re-announce, cross-cosigner fan-out union, revocation, and immutability.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { buildContactBindingMessage, type SignedContactBinding } from './contactBinding';
import {
  emptyRegistry,
  addBinding,
  contactsForAccount,
  contactsForAccounts,
  isKnownContact,
  removeContact,
  knownAccounts,
} from './contactRegistry';

let alice: KeyringPair;
let bob: KeyringPair;
let mallory: KeyringPair;

beforeAll(async () => {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519', ss58Format: 55 });
  alice = keyring.addFromUri('//reg-alice');
  bob = keyring.addFromUri('//reg-bob');
  mallory = keyring.addFromUri('//reg-mallory');
});

function bind(pair: KeyringPair, account: string, contact: Uint8Array): SignedContactBinding {
  return { account, cMixContact: contact, signature: pair.sign(buildContactBindingMessage(account, contact)) };
}

const ALICE_PHONE = new Uint8Array([1, 1, 1, 1]);
const ALICE_LAPTOP = new Uint8Array([2, 2, 2, 2]);
const BOB_PHONE = new Uint8Array([3, 3, 3, 3]);

function withBindings(...bindings: SignedContactBinding[]) {
  let reg = emptyRegistry();
  for (const b of bindings) {
    const r = addBinding(reg, b);
    if (r.ok) reg = r.registry;
  }
  return reg;
}

describe('addBinding', () => {
  it('adds a verified binding and surfaces its contact', () => {
    const r = addBinding(emptyRegistry(), bind(alice, alice.address, ALICE_PHONE));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.added).toBe(true);
      expect(contactsForAccount(r.registry, alice.address).map((c) => Array.from(c))).toEqual([
        Array.from(ALICE_PHONE),
      ]);
    }
  });

  it('rejects a binding that does not verify (impostor signed for someone else)', () => {
    const r = addBinding(emptyRegistry(), bind(mallory, alice.address, ALICE_PHONE));
    expect(r.ok).toBe(false);
  });

  it('is idempotent on a repeat announce of the same contact', () => {
    const reg = withBindings(bind(alice, alice.address, ALICE_PHONE));
    const again = addBinding(reg, bind(alice, alice.address, ALICE_PHONE));
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.added).toBe(false);
      expect(contactsForAccount(again.registry, alice.address)).toHaveLength(1);
    }
  });

  it('keeps multiple devices for one account (the multi-device case)', () => {
    const reg = withBindings(
      bind(alice, alice.address, ALICE_PHONE),
      bind(alice, alice.address, ALICE_LAPTOP)
    );
    expect(contactsForAccount(reg, alice.address)).toHaveLength(2);
  });

  it('does not mutate the input registry', () => {
    const reg = emptyRegistry();
    addBinding(reg, bind(alice, alice.address, ALICE_PHONE));
    expect(knownAccounts(reg)).toHaveLength(0);
  });
});

describe('contactsForAccounts (fan-out)', () => {
  it('unions device-contacts across cosigner accounts', () => {
    const reg = withBindings(
      bind(alice, alice.address, ALICE_PHONE),
      bind(alice, alice.address, ALICE_LAPTOP),
      bind(bob, bob.address, BOB_PHONE)
    );
    expect(contactsForAccounts(reg, [alice.address, bob.address])).toHaveLength(3);
  });

  it('returns nothing for unknown accounts', () => {
    expect(contactsForAccounts(emptyRegistry(), [alice.address])).toHaveLength(0);
  });
});

describe('isKnownContact (auto-confirm gate)', () => {
  // Stand-in for canonical reception-ID equality: "same identity" iff the first
  // byte matches, independent of length/trailing bytes — mirroring how a channel
  // request's contact (with an ownership proof) differs in raw bytes from the
  // stored GetContact() form yet resolves to the same reception ID.
  const sameIdentity = (a: Uint8Array, b: Uint8Array) =>
    a.length > 0 && b.length > 0 && a[0] === b[0];
  // A raw byte comparator — what we used to (wrongly) match on.
  const sameBytes = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((x, i) => x === b[i]);

  it('returns false for an empty registry', () => {
    expect(isKnownContact(emptyRegistry(), ALICE_PHONE, sameIdentity)).toBe(false);
  });

  it('matches a known cosigner even when raw bytes differ (request vs GetContact form)', () => {
    const reg = withBindings(bind(alice, alice.address, ALICE_PHONE));
    // Same identity (leading byte 1), different length + trailing bytes.
    const requestForm = new Uint8Array([1, 9, 9, 9, 9, 9, 9]);
    expect(isKnownContact(reg, requestForm, sameIdentity)).toBe(true);
    // A raw byte-match would have missed it — which was the live failure.
    expect(isKnownContact(reg, requestForm, sameBytes)).toBe(false);
  });

  it('does not match an unknown identity', () => {
    const reg = withBindings(bind(alice, alice.address, ALICE_PHONE));
    expect(isKnownContact(reg, new Uint8Array([9, 9, 9]), sameIdentity)).toBe(false);
  });

  it('matches against any registered account (fan-in across cosigners)', () => {
    const reg = withBindings(
      bind(alice, alice.address, ALICE_PHONE),
      bind(bob, bob.address, BOB_PHONE)
    );
    expect(isKnownContact(reg, new Uint8Array([3, 0]), sameIdentity)).toBe(true); // Bob
  });
});

describe('removeContact (revocation)', () => {
  it('drops a single device and prunes the account when empty', () => {
    let reg = withBindings(bind(alice, alice.address, ALICE_PHONE));
    reg = removeContact(reg, alice.address, ALICE_PHONE);
    expect(contactsForAccount(reg, alice.address)).toHaveLength(0);
    expect(knownAccounts(reg)).toHaveLength(0);
  });

  it('keeps the other device when only one is revoked', () => {
    let reg = withBindings(
      bind(alice, alice.address, ALICE_PHONE),
      bind(alice, alice.address, ALICE_LAPTOP)
    );
    reg = removeContact(reg, alice.address, ALICE_PHONE);
    expect(contactsForAccount(reg, alice.address).map((c) => Array.from(c))).toEqual([
      Array.from(ALICE_LAPTOP),
    ]);
  });
});
