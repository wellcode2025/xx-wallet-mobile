/**
 * Tests for the pure-function pieces of decodeCall.ts.
 *
 * We cover what we can without spinning up a connected ApiPromise:
 *   - verifyCallHash: the load-bearing security check. blake2_256(bytes)
 *     must match the on-chain call hash. Tests cover happy path,
 *     tamper-detection, and malformed input.
 *   - normalizeCallBytes: canonicalization helper used for cache keys.
 *
 * `decodeCall` itself needs a connected ApiPromise (it uses
 * api.registry.createType against the runtime metadata). That's an
 * integration concern — covered by end-to-end manual testing in the
 * acceptance flow rather than here.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { hexToU8a } from '@polkadot/util';
import { blake2AsHex, cryptoWaitReady } from '@polkadot/util-crypto';
import { normalizeCallBytes, verifyCallHash } from './decodeCall';

// A real-ish call payload — the exact bytes don't matter for verifyCallHash
// (which just hashes them); we just need a stable input. Hex represents
// roughly: `balances.transferKeepAlive(dest=Id(6...), value=2_000_000_000_000_000)`
// constructed by hand to a plausible length. The blake2 of these bytes is
// computed at test time, so we don't need to ship a hardcoded hash either.
const PLAUSIBLE_BYTES_HEX =
  '0x040300' +
  '6e1ee5ff89f7f5c0d61f93e4b4f8a2d51e0bbf3a4c5d6e7f8091a2b3c4d5e6f7' +
  '0700' +
  '0070c9b28b2904';

describe('verifyCallHash', () => {
  beforeAll(async () => {
    // blake2 needs WASM crypto initialized.
    await cryptoWaitReady();
  });

  describe('happy path', () => {
    it('accepts bytes whose blake2_256 matches the expected hash', () => {
      const expected = blake2AsHex(hexToU8a(PLAUSIBLE_BYTES_HEX), 256);
      expect(verifyCallHash(PLAUSIBLE_BYTES_HEX, expected)).toBe(true);
    });

    it('accepts a Uint8Array input form', () => {
      const u8 = hexToU8a(PLAUSIBLE_BYTES_HEX);
      const expected = blake2AsHex(u8, 256);
      expect(verifyCallHash(u8, expected)).toBe(true);
    });

    it('is case-insensitive on the expected-hash hex', () => {
      const expected = blake2AsHex(hexToU8a(PLAUSIBLE_BYTES_HEX), 256);
      expect(verifyCallHash(PLAUSIBLE_BYTES_HEX, expected.toUpperCase())).toBe(true);
    });

    it('tolerates an expected-hash without 0x prefix', () => {
      const expected = blake2AsHex(hexToU8a(PLAUSIBLE_BYTES_HEX), 256);
      expect(verifyCallHash(PLAUSIBLE_BYTES_HEX, expected.slice(2))).toBe(true);
    });
  });

  describe('tamper detection (the security-critical path)', () => {
    it('rejects bytes that have been altered by a single hex digit', () => {
      const expected = blake2AsHex(hexToU8a(PLAUSIBLE_BYTES_HEX), 256);
      // Flip the very last hex digit of the bytes — minimal change.
      const tampered = PLAUSIBLE_BYTES_HEX.slice(0, -1) + '5';
      expect(verifyCallHash(tampered, expected)).toBe(false);
    });

    it('rejects bytes prepended with extra data', () => {
      const expected = blake2AsHex(hexToU8a(PLAUSIBLE_BYTES_HEX), 256);
      const tampered = '0xff' + PLAUSIBLE_BYTES_HEX.slice(2);
      expect(verifyCallHash(tampered, expected)).toBe(false);
    });

    it('rejects when the expected hash is for a different call', () => {
      const expectedForOther = blake2AsHex(hexToU8a('0xdeadbeef'), 256);
      expect(verifyCallHash(PLAUSIBLE_BYTES_HEX, expectedForOther)).toBe(false);
    });

    it('rejects empty bytes (no proposal can be empty)', () => {
      const expected = blake2AsHex(new Uint8Array([1, 2, 3]), 256);
      expect(verifyCallHash('0x', expected)).toBe(false);
      expect(verifyCallHash(new Uint8Array(), expected)).toBe(false);
    });
  });

  describe('rejects garbage input gracefully', () => {
    it('returns false on non-hex byte string', () => {
      const expected = blake2AsHex(hexToU8a(PLAUSIBLE_BYTES_HEX), 256);
      expect(verifyCallHash('not-hex-at-all', expected)).toBe(false);
    });

    it('returns false on an empty expected hash', () => {
      expect(verifyCallHash(PLAUSIBLE_BYTES_HEX, '')).toBe(false);
    });

    // The check is a guard, not a validator — it must NEVER throw because
    // a single throwing call site could leave the wallet in an
    // inconsistent state. Returning false is always safe.
    it('does not throw on any pathological input', () => {
      expect(() => verifyCallHash('', '')).not.toThrow();
      expect(() => verifyCallHash('not hex', 'also not hex')).not.toThrow();
      expect(() =>
        verifyCallHash(new Uint8Array([0xff]), '0x')
      ).not.toThrow();
    });
  });
});

describe('normalizeCallBytes', () => {
  it('strips uppercase 0x prefix and lowercases hex', () => {
    expect(normalizeCallBytes('0XAB12CDef')).toBe('0xab12cdef');
  });

  it('adds 0x prefix when missing', () => {
    expect(normalizeCallBytes('ab12cdef')).toBe('0xab12cdef');
  });

  it('passes through already-canonical hex unchanged', () => {
    expect(normalizeCallBytes('0xab12cdef')).toBe('0xab12cdef');
  });

  it('serializes Uint8Array to canonical 0x-prefixed lowercase hex', () => {
    const u8 = new Uint8Array([0xab, 0x12, 0xcd, 0xef]);
    expect(normalizeCallBytes(u8)).toBe('0xab12cdef');
  });
});

// ---------------------------------------------------------------------------
// safeDecodeCall — the non-throwing wrapper used by the preimage page.
//
// We can't drive the real registry path without a connected ApiPromise (the
// throwing path is integration-tested manually, per the file-level note).
// What we CAN unit-test here is the wrapper's contract: when the registry
// throws, safeDecodeCall returns { ok: false } with the canonical rawHex,
// surfacing the throw's message without swallowing it. We synthesize a
// stub registry that always throws — exactly the failure mode the orphaned
// 3,896-byte preimage at 0xa2652f1879c182… produced in the governance spike
// ("Unable to find Call with index [35, 35]").
// ---------------------------------------------------------------------------

import { DECODE_FAILURE_LABEL, safeDecodeCall } from './decodeCall';

type AnyApi = Parameters<typeof safeDecodeCall>[1];

function apiThatThrows(message: string): AnyApi {
  return {
    registry: {
      createType: () => {
        throw new Error(message);
      },
    },
  } as unknown as AnyApi;
}

describe('safeDecodeCall', () => {
  it('returns ok:false with the canonical rawHex when the registry throws', () => {
    const api = apiThatThrows(
      'createType(Call):: findMetaCall: Unable to find Call with index [35, 35]/[35,35]'
    );
    // Reproduces the orphaned-preimage failure from the governance spike at
    // hash 0xa2652f1879c182… — call index bytes that don't map to any
    // registered call in xxnetwork v206 metadata.
    const result = safeDecodeCall('0x2323deadbeef', api);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.rawHex).toBe('0x2323deadbeef');
    expect(result.error).toContain('Unable to find Call with index');
  });

  it('canonicalises rawHex for unprefixed input', () => {
    const api = apiThatThrows('boom');
    const result = safeDecodeCall('AB12CD', api);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.rawHex).toBe('0xab12cd');
  });

  it('preserves the error message verbatim for debug display', () => {
    const api = apiThatThrows('some specific decoder error');
    const result = safeDecodeCall('0x00', api);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe('some specific decoder error');
  });

  it('does not silently swallow non-Error throws', () => {
    const api: AnyApi = {
      registry: {
        createType: () => {
          // eslint-disable-next-line no-throw-literal
          throw 'string-not-Error';
        },
      },
    } as unknown as AnyApi;
    const result = safeDecodeCall('0x00', api);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe('string-not-Error');
  });
});

describe('DECODE_FAILURE_LABEL', () => {
  it('matches the official xx web wallet copy verbatim', () => {
    // Keeping this in lockstep with the web wallet is a UX contract —
    // see the file-level note on safeDecodeCall.
    expect(DECODE_FAILURE_LABEL).toBe(
      'Unable to decode preimage bytes into a valid Call'
    );
  });
});
