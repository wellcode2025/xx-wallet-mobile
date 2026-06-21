/**
 * Tests for the account-anchored cMix contact binding.
 *
 * Security focus: a binding verifies ONLY when signed by the key of the account
 * it claims (so an impostor can't bind their contact to someone else's account),
 * and any tampering of the bound contact invalidates it. The signing side uses a
 * real sr25519 keypair; verification goes through the production path.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  buildContactBindingMessage,
  signContactBinding,
  verifyContactBinding,
  serializeSignedBinding,
  parseSignedBinding,
  type SignedContactBinding,
} from './contactBinding';

const CONTACT = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252, 0, 128]);

let alice: KeyringPair; // the legitimate account holder
let mallory: KeyringPair; // an impostor with a different key

beforeAll(async () => {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519', ss58Format: 55 });
  alice = keyring.addFromUri('//cmix-alice');
  mallory = keyring.addFromUri('//cmix-mallory');
});

/** Produce a binding signed by `pair` but claiming `account`. */
function bind(pair: KeyringPair, account: string, contact: Uint8Array): SignedContactBinding {
  return { account, cMixContact: contact, signature: pair.sign(buildContactBindingMessage(account, contact)) };
}

describe('verifyContactBinding', () => {
  it('accepts a binding signed by the account it claims', () => {
    expect(verifyContactBinding(bind(alice, alice.address, CONTACT))).toBe(true);
  });

  it('rejects a binding whose contact was swapped after signing', () => {
    const b = bind(alice, alice.address, CONTACT);
    expect(verifyContactBinding({ ...b, cMixContact: new Uint8Array([9, 9, 9]) })).toBe(false);
  });

  it('rejects an impostor binding (signed by a different key than the claimed account)', () => {
    // Mallory signs a binding that claims to be Alice's account.
    const impostor = bind(mallory, alice.address, CONTACT);
    expect(verifyContactBinding(impostor)).toBe(false);
  });

  it('rejects an invalid account address', () => {
    const b = bind(alice, alice.address, CONTACT);
    expect(verifyContactBinding({ ...b, account: 'not-an-address' })).toBe(false);
  });

  it('rejects a garbage signature without throwing', () => {
    const b = bind(alice, alice.address, CONTACT);
    expect(verifyContactBinding({ ...b, signature: new Uint8Array([1, 2, 3]) })).toBe(false);
  });
});

describe('signContactBinding', () => {
  it('produces a binding bound to the signer account that verifies', () => {
    const b = signContactBinding(alice, new Uint8Array([10, 20, 30]));
    expect(b.account).toBe(alice.address);
    expect(verifyContactBinding(b)).toBe(true);
  });

  it('cannot be re-claimed by another account (signature is over the signer address)', () => {
    const b = signContactBinding(alice, new Uint8Array([10, 20, 30]));
    expect(verifyContactBinding({ ...b, account: mallory.address })).toBe(false);
  });
});

describe('serialize / parse', () => {
  it('round-trips a signed binding and it still verifies', () => {
    const b = bind(alice, alice.address, CONTACT);
    const parsed = parseSignedBinding(serializeSignedBinding(b));
    expect(parsed).not.toBeNull();
    if (parsed) {
      expect(parsed.account).toBe(b.account);
      expect(Array.from(parsed.cMixContact)).toEqual(Array.from(CONTACT));
      expect(verifyContactBinding(parsed)).toBe(true);
    }
  });

  it('returns null on malformed input', () => {
    expect(parseSignedBinding('not json {')).toBeNull();
    expect(parseSignedBinding('{}')).toBeNull();
    expect(parseSignedBinding(42)).toBeNull();
    expect(parseSignedBinding(null)).toBeNull();
  });
});
