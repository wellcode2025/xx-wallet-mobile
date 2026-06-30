/**
 * Tests for the portable messaging-identity export envelope.
 *
 * Security-critical: an export must round-trip back to the exact identity under
 * the right passphrase, fail closed on a wrong one, and reject anything that
 * isn't a recognised, same-or-older-version envelope before attempting decrypt.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  encryptIdentityExport,
  decryptIdentityExport,
  readIdHint,
  idHintFrom,
} from './identityExport';

beforeAll(async () => {
  await cryptoWaitReady();
});

describe('identityExport envelope', () => {
  const PASS = 'my dedicated messaging passphrase';
  // Stand-in for the marshalled reception identity (the real one is ~6.8 KB; the
  // crypto is size-agnostic, so a small fixed buffer keeps the test quick).
  const identity = Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 3) & 0xff);
  let envelope: string;

  beforeAll(async () => {
    envelope = await encryptIdentityExport(identity, PASS, idHintFrom(identity));
  }, 30000);

  it('round-trips the identity under the right passphrase', async () => {
    const out = await decryptIdentityExport(envelope, PASS);
    expect(Array.from(out)).toEqual(Array.from(identity));
  }, 30000);

  it('fails closed on a wrong passphrase', async () => {
    await expect(decryptIdentityExport(envelope, 'wrong passphrase')).rejects.toThrow(/incorrect/i);
  }, 30000);

  it('exposes the non-secret id hint without decrypting', () => {
    expect(readIdHint(envelope)).toBe(idHintFrom(identity));
  });

  it('rejects non-envelope text', async () => {
    await expect(decryptIdentityExport('not json at all', PASS)).rejects.toThrow(/doesn't look like/i);
  });

  it('rejects JSON that is not an xx identity export', async () => {
    await expect(decryptIdentityExport(JSON.stringify({ hello: 1 }), PASS)).rejects.toThrow(
      /messaging-identity export/i
    );
  });

  it('rejects a newer-version envelope before trying to decrypt', async () => {
    const future = JSON.stringify({ magic: 'XXMSGID', v: 999, blob: 'whatever' });
    await expect(decryptIdentityExport(future, PASS)).rejects.toThrow(/newer version/i);
  });
});

describe('idHintFrom', () => {
  it('renders the first four bytes as hex', () => {
    expect(idHintFrom(Uint8Array.from([0x3e, 0xa9, 0x4d, 0xa5, 0xff, 0x00]))).toBe('3ea94da5');
  });
});

describe('readIdHint', () => {
  it('returns null for non-envelope text', () => {
    expect(readIdHint('garbage')).toBeNull();
  });
});
