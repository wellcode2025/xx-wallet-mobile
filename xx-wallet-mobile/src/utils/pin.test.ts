import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, randomSaltHex } from './pin';

describe('PIN hashing', () => {
  it('verifies the correct PIN and rejects a wrong one', async () => {
    const salt = randomSaltHex();
    const hash = await hashPin('123456', salt);
    expect(await verifyPin('123456', salt, hash)).toBe(true);
    expect(await verifyPin('000000', salt, hash)).toBe(false);
  });

  it('uses a random salt, so the same PIN hashes differently', async () => {
    const h1 = await hashPin('123456', randomSaltHex());
    const h2 = await hashPin('123456', randomSaltHex());
    expect(h1).not.toBe(h2);
  });

  it('produces a 32-byte (64 hex char) hash', async () => {
    const hash = await hashPin('654321', randomSaltHex());
    expect(hash).toHaveLength(64);
  });
});
