/**
 * Tests for the cMix storage-secret wrap/unwrap.
 *
 * Security focus: a round-trip recovers the exact secret, a wrong password
 * fails (never returns garbage), and a crafted blob with out-of-range scrypt
 * params is rejected before scrypt can allocate (the keystore's audited bound).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { base64Decode, base64Encode, cryptoWaitReady } from '@polkadot/util-crypto';
import {
  STORAGE_SECRET_LEN,
  generateStorageSecret,
  unwrapSecret,
  wrapSecret,
} from './storageSecret';

beforeAll(async () => {
  await cryptoWaitReady();
});

describe('generateStorageSecret', () => {
  it('returns 32 random bytes that differ between calls', () => {
    const a = generateStorageSecret();
    const b = generateStorageSecret();
    expect(a).toHaveLength(STORAGE_SECRET_LEN);
    expect(b).toHaveLength(STORAGE_SECRET_LEN);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe('wrap / unwrap', () => {
  it('round-trips a secret under the right password', async () => {
    const secret = generateStorageSecret();
    const wrapped = await wrapSecret(secret, 'correct horse battery staple');
    const back = await unwrapSecret(wrapped, 'correct horse battery staple');
    expect(Array.from(back)).toEqual(Array.from(secret));
  });

  it('produces a JSON-safe (base64) blob and a fresh one each call', async () => {
    const secret = generateStorageSecret();
    const a = await wrapSecret(secret, 'pw');
    const b = await wrapSecret(secret, 'pw');
    expect(() => JSON.stringify({ a })).not.toThrow();
    expect(a).not.toEqual(b); // fresh salt + nonce
  });

  it('fails on a wrong password instead of returning garbage', async () => {
    const wrapped = await wrapSecret(generateStorageSecret(), 'right');
    await expect(unwrapSecret(wrapped, 'wrong')).rejects.toThrow(/incorrect password/i);
  });

  it('rejects a too-short blob', async () => {
    await expect(unwrapSecret(base64Encode(new Uint8Array(10)), 'pw')).rejects.toThrow(/too short/i);
  });

  it('rejects out-of-range scrypt params (crafted blob)', async () => {
    const bytes = base64Decode(await wrapSecret(generateStorageSecret(), 'pw'));
    // Overwrite N (offset 32) with 2^30 — a power of two, but far over the cap.
    new DataView(bytes.buffer, bytes.byteOffset).setUint32(32, 1 << 30, true);
    await expect(unwrapSecret(base64Encode(bytes), 'pw')).rejects.toThrow(/out-of-range/i);
  });
});
