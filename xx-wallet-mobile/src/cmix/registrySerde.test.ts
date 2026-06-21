/**
 * Tests for registry (de)serialization — the persistence bridge.
 *
 * The round-trip must preserve verifiable contacts, the serialized form must be
 * JSON-safe (it's persisted), and a corrupted blob must degrade gracefully
 * (drop bad entries, never throw).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { Keyring } from '@polkadot/keyring';
import type { KeyringPair } from '@polkadot/keyring/types';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import { buildContactBindingMessage, type SignedContactBinding } from './contactBinding';
import { addBinding, contactsForAccount, emptyRegistry } from './contactRegistry';
import { deserializeRegistry, serializeRegistry } from './registrySerde';

let alice: KeyringPair;
let bob: KeyringPair;

beforeAll(async () => {
  await cryptoWaitReady();
  const keyring = new Keyring({ type: 'sr25519', ss58Format: 55 });
  alice = keyring.addFromUri('//serde-alice');
  bob = keyring.addFromUri('//serde-bob');
});

function bind(pair: KeyringPair, account: string, contact: Uint8Array): SignedContactBinding {
  return { account, cMixContact: contact, signature: pair.sign(buildContactBindingMessage(account, contact)) };
}

function build(...bindings: SignedContactBinding[]) {
  let reg = emptyRegistry();
  for (const b of bindings) {
    const r = addBinding(reg, b);
    if (r.ok) reg = r.registry;
  }
  return reg;
}

describe('registry serde', () => {
  it('round-trips a registry and preserves verifiable contacts', () => {
    const reg = build(
      bind(alice, alice.address, new Uint8Array([1, 2, 3])),
      bind(bob, bob.address, new Uint8Array([4, 5, 6]))
    );
    const back = deserializeRegistry(serializeRegistry(reg));
    expect(contactsForAccount(back, alice.address).map((c) => Array.from(c))).toEqual([[1, 2, 3]]);
    expect(contactsForAccount(back, bob.address).map((c) => Array.from(c))).toEqual([[4, 5, 6]]);
  });

  it('produces a JSON-safe serialized form', () => {
    const serialized = serializeRegistry(build(bind(alice, alice.address, new Uint8Array([7, 8, 9]))));
    expect(() => JSON.stringify(serialized)).not.toThrow();
    const reloaded = deserializeRegistry(JSON.parse(JSON.stringify(serialized)));
    expect(contactsForAccount(reloaded, alice.address)).toHaveLength(1);
  });

  it('drops malformed entries on deserialize instead of throwing', () => {
    const reg = deserializeRegistry({ [alice.address]: ['not-valid-json {', '{}'] });
    expect(contactsForAccount(reg, alice.address)).toHaveLength(0);
  });

  it('handles an empty, undefined, or null map', () => {
    expect(deserializeRegistry({}).byAccount).toEqual({});
    expect(deserializeRegistry(undefined).byAccount).toEqual({});
    expect(deserializeRegistry(null).byAccount).toEqual({});
  });
});
