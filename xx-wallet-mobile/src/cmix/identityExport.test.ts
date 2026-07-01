/**
 * Tests for the portable messaging-identities backup envelope.
 *
 * Security-critical: a backup must round-trip back to the exact identities under
 * the right passphrase, fail closed on a wrong one, and reject anything that
 * isn't a recognised, same-or-older-version envelope before attempting decrypt.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  encryptIdentitiesExport,
  decryptIdentitiesExport,
  readBackupCount,
} from './identityExport';

beforeAll(async () => {
  await cryptoWaitReady();
});

describe('identities backup envelope', () => {
  const PASS = 'my dedicated messaging passphrase';
  // Stand-ins for the marshalled reception identities (the crypto is
  // size-agnostic, so small fixed buffers keep the test quick).
  const entries = [
    { account: '6Alice', identity: Uint8Array.from({ length: 40 }, (_, i) => (i * 7 + 3) & 0xff) },
    { account: '6Bob', identity: Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 1) & 0xff) },
  ];
  let envelope: string;

  beforeAll(async () => {
    envelope = await encryptIdentitiesExport(entries, PASS);
  }, 30000);

  it('round-trips all identities under the right passphrase', async () => {
    const out = await decryptIdentitiesExport(envelope, PASS);
    expect(out).toHaveLength(2);
    expect(out[0].account).toBe('6Alice');
    expect(Array.from(out[0].identity)).toEqual(Array.from(entries[0].identity));
    expect(out[1].account).toBe('6Bob');
    expect(Array.from(out[1].identity)).toEqual(Array.from(entries[1].identity));
  }, 30000);

  it('fails closed on a wrong passphrase', async () => {
    await expect(decryptIdentitiesExport(envelope, 'wrong passphrase')).rejects.toThrow(/incorrect/i);
  }, 30000);

  it('exposes the non-secret count without decrypting', () => {
    expect(readBackupCount(envelope)).toBe(2);
  });

  it('rejects non-envelope text', async () => {
    await expect(decryptIdentitiesExport('not json at all', PASS)).rejects.toThrow(/doesn't look like/i);
  });

  it('rejects JSON that is not an xx backup', async () => {
    await expect(decryptIdentitiesExport(JSON.stringify({ hello: 1 }), PASS)).rejects.toThrow(
      /messaging-identity backup/i
    );
  });

  it('rejects a newer-version envelope before trying to decrypt', async () => {
    const future = JSON.stringify({ magic: 'XXMSGID', v: 999, blob: 'whatever' });
    await expect(decryptIdentitiesExport(future, PASS)).rejects.toThrow(/newer version/i);
  });
});

describe('readBackupCount', () => {
  it('returns null for non-envelope text', () => {
    expect(readBackupCount('garbage')).toBeNull();
  });
});
