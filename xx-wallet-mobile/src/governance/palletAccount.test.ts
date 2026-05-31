/**
 * Tests for deriveModuleAccount.
 *
 * The derivation is substrate's into_account_truncating convention:
 *   account = "modl" || palletId(8) || zeros(20)
 *
 * Cross-chain sanity check uses Polkadot's known treasury account:
 *   palletId = "py/trsry"  (0x70792f7472737279)
 *   SS58(prefix 0) = 13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB
 *
 * For xx we verify the derivation runs and produces a valid SS58 (starts
 * with "6", correct length). The exact xx treasury address is then a
 * phone-test verification — it should match what the official web wallet
 * shows under Treasury → Spendable.
 */

import { describe, expect, it } from 'vitest';
import { stringToU8a } from '@polkadot/util';
import { deriveModuleAccount } from './palletAccount';

describe('deriveModuleAccount — Polkadot treasury cross-chain fixture', () => {
  it('matches the known Polkadot treasury address', () => {
    // Polkadot's treasury palletId = "py/trsry" (8 ASCII bytes).
    const palletId = stringToU8a('py/trsry');
    expect(palletId.length).toBe(8);
    // SS58 prefix 0 = Polkadot.
    const addr = deriveModuleAccount(palletId, 0);
    expect(addr).toBe('13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB');
  });
});

describe('deriveModuleAccount — xx network treasury', () => {
  it("produces a valid xx SS58 from the spike's observed palletId", () => {
    // From the Phase 4 spike: api.consts.treasury.palletId = 0x78782f7472737279
    // which is the ASCII for "xx/trsry".
    const palletId = stringToU8a('xx/trsry');
    expect(palletId.length).toBe(8);
    const addr = deriveModuleAccount(palletId); // default ss58Prefix = 55
    // xx SS58 addresses start with "6".
    expect(addr.startsWith('6')).toBe(true);
    // SS58 length is 47–48 chars for a 32-byte account.
    expect(addr.length).toBeGreaterThanOrEqual(47);
    expect(addr.length).toBeLessThanOrEqual(48);
  });

  it('is deterministic — same palletId always yields the same address', () => {
    const palletId = stringToU8a('xx/trsry');
    const a = deriveModuleAccount(palletId);
    const b = deriveModuleAccount(palletId);
    expect(a).toBe(b);
  });

  it('different palletIds yield different addresses', () => {
    const treasury = stringToU8a('xx/trsry');
    const bounties = stringToU8a('xx/bnty1');
    expect(deriveModuleAccount(treasury)).not.toBe(
      deriveModuleAccount(bounties)
    );
  });
});

describe('deriveModuleAccount — validation', () => {
  it('throws when palletId is not 8 bytes', () => {
    expect(() => deriveModuleAccount(new Uint8Array(7))).toThrow(
      /must be 8 bytes/
    );
    expect(() => deriveModuleAccount(new Uint8Array(9))).toThrow(
      /must be 8 bytes/
    );
  });
});
