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
