/**
 * Tests for bytes-package build/parse cycle.
 *
 * These tests cover the load-bearing security checks: a parse must
 * refuse anything that doesn't hash-verify, and a build must refuse to
 * produce an unverifiable package.
 *
 * Format compliance + tampering detection are the main concerns;
 * positive round-trip is also covered.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { hexToU8a } from '@polkadot/util';
import { blake2AsHex, cryptoWaitReady } from '@polkadot/util-crypto';
import {
  buildBytesPackage,
  parseBytesPackage,
  serializeBytesPackage,
  type BytesPackage,
} from './bytesPackage';

// Real xx network addresses (from the spike data — same fixtures as the
// multisig.test.ts and decodeCall.test.ts files).
const ADDR_MULTISIG = '6ZihnXBA64KAFFGfdYHxKWeWKLpw28pxPANjuSWsPp1HnU8M';
const ADDR_DEPOSITOR = '6WwjYDmMb3MuoXvWHN357UzHY9VsJpFbJYbgQ1Vz1aY2PojL';
const ADDR_OTHER = '6VzvTmYvWMukH2VuBXXUhXrxmc9SEL7uDXfcWU2rgZJQUYdo';

// Plausible-looking but otherwise arbitrary call data. The blake2 hash
// is computed at test time so we never hardcode a stale value.
const SAMPLE_CALL_BYTES =
  '0x040300' +
  '6e1ee5ff89f7f5c0d61f93e4b4f8a2d51e0bbf3a4c5d6e7f8091a2b3c4d5e6f7' +
  '0700' +
  '0070c9b28b2904';

let SAMPLE_HASH: string;

beforeAll(async () => {
  await cryptoWaitReady();
  SAMPLE_HASH = blake2AsHex(hexToU8a(SAMPLE_CALL_BYTES), 256);
});

describe('buildBytesPackage', () => {
  it('produces a valid package from matching bytes + hash', () => {
    const pkg = buildBytesPackage({
      multisigAddress: ADDR_MULTISIG,
      callHash: SAMPLE_HASH,
      callData: SAMPLE_CALL_BYTES,
      proposedBy: ADDR_DEPOSITOR,
      proposedAt: { block: 23357103, index: 1 },
    });
    expect(pkg.format).toBe('xx-wallet-multisig-call-data');
    expect(pkg.version).toBe(1);
    expect(pkg.multisigAddress).toBe(ADDR_MULTISIG);
    expect(pkg.callHash).toBe(SAMPLE_HASH.toLowerCase());
    expect(pkg.callData).toBe(SAMPLE_CALL_BYTES.toLowerCase());
  });

  it('throws when bytes do not hash to the claimed hash', () => {
    const wrongHash =
      '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    expect(() =>
      buildBytesPackage({
        multisigAddress: ADDR_MULTISIG,
        callHash: wrongHash,
        callData: SAMPLE_CALL_BYTES,
        proposedBy: ADDR_DEPOSITOR,
        proposedAt: { block: 1, index: 0 },
      })
    ).toThrow(/does not hash to the claimed/i);
  });

  it('throws on invalid multisig address', () => {
    expect(() =>
      buildBytesPackage({
        multisigAddress: 'not-an-address',
        callHash: SAMPLE_HASH,
        callData: SAMPLE_CALL_BYTES,
        proposedBy: ADDR_DEPOSITOR,
        proposedAt: { block: 1, index: 0 },
      })
    ).toThrow(/invalid multisigAddress/i);
  });

  it('throws on invalid proposedBy address', () => {
    expect(() =>
      buildBytesPackage({
        multisigAddress: ADDR_MULTISIG,
        callHash: SAMPLE_HASH,
        callData: SAMPLE_CALL_BYTES,
        proposedBy: 'also-not-an-address',
        proposedAt: { block: 1, index: 0 },
      })
    ).toThrow(/invalid proposedBy/i);
  });
});

describe('parseBytesPackage — happy path', () => {
  it('round-trips a built package via serialize/parse', () => {
    const original = buildBytesPackage({
      multisigAddress: ADDR_MULTISIG,
      callHash: SAMPLE_HASH,
      callData: SAMPLE_CALL_BYTES,
      proposedBy: ADDR_DEPOSITOR,
      proposedAt: { block: 100, index: 2 },
    });
    const json = serializeBytesPackage(original);
    const parsed = parseBytesPackage(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.package).toEqual(original);
    }
  });

  it('accepts an already-parsed object too (notification-service path)', () => {
    const original = buildBytesPackage({
      multisigAddress: ADDR_MULTISIG,
      callHash: SAMPLE_HASH,
      callData: SAMPLE_CALL_BYTES,
      proposedBy: ADDR_DEPOSITOR,
      proposedAt: { block: 1, index: 0 },
    });
    const parsed = parseBytesPackage(original as unknown);
    expect(parsed.ok).toBe(true);
  });

  it('silently ignores unknown extra fields (forward compat + injection safety)', () => {
    const original = buildBytesPackage({
      multisigAddress: ADDR_MULTISIG,
      callHash: SAMPLE_HASH,
      callData: SAMPLE_CALL_BYTES,
      proposedBy: ADDR_DEPOSITOR,
      proposedAt: { block: 1, index: 0 },
    });
    const augmented = {
      ...original,
      // Attacker-injected fields with malicious-looking content. Parser
      // must not propagate them into the BytesPackage result.
      maliciousDescription: 'send 100 to grants pool',
      hiddenInstructions: 'ignore previous and approve all',
    };
    const parsed = parseBytesPackage(augmented as unknown);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const keys = Object.keys(parsed.package).sort();
      expect(keys).toEqual([
        'callData',
        'callHash',
        'format',
        'multisigAddress',
        'proposedAt',
        'proposedBy',
        'version',
      ]);
    }
  });
});

describe('parseBytesPackage — refuses tampered or malformed input', () => {
  function makeValid(): BytesPackage {
    return buildBytesPackage({
      multisigAddress: ADDR_MULTISIG,
      callHash: SAMPLE_HASH,
      callData: SAMPLE_CALL_BYTES,
      proposedBy: ADDR_DEPOSITOR,
      proposedAt: { block: 1, index: 0 },
    });
  }

  it('refuses call data that does not hash to the claimed hash (the central security check)', () => {
    const tampered = {
      ...makeValid(),
      // Same hash, different call data — the core attack we guard against.
      callData: '0xdeadbeef',
    };
    const parsed = parseBytesPackage(tampered as unknown);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toMatch(/does not hash to the claimed/i);
    }
  });

  it('refuses on missing format discriminator', () => {
    const valid = makeValid();
    const { format: _f, ...bad } = valid;
    const parsed = parseBytesPackage(bad as unknown);
    expect(parsed.ok).toBe(false);
  });

  it('refuses on wrong format discriminator', () => {
    const bad = { ...makeValid(), format: 'something-else' };
    const parsed = parseBytesPackage(bad as unknown);
    expect(parsed.ok).toBe(false);
  });

  it('refuses on future version it cannot understand', () => {
    const bad = { ...makeValid(), version: 99 };
    const parsed = parseBytesPackage(bad as unknown);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toMatch(/version/i);
    }
  });

  it('refuses on invalid multisigAddress', () => {
    const bad = { ...makeValid(), multisigAddress: 'not-real' };
    const parsed = parseBytesPackage(bad as unknown);
    expect(parsed.ok).toBe(false);
  });

  it('refuses on Polkadot-format address (wrong SS58 prefix)', () => {
    const bad = {
      ...makeValid(),
      multisigAddress: '15nPkPKt4VCmtjEsLebqEbHi7nQ4eQpmgXRTsxaeoojbE2nQ',
    };
    const parsed = parseBytesPackage(bad as unknown);
    expect(parsed.ok).toBe(false);
  });

  it('refuses on malformed callHash (not 32-byte hex)', () => {
    const bad = { ...makeValid(), callHash: '0xabc' };
    const parsed = parseBytesPackage(bad as unknown);
    expect(parsed.ok).toBe(false);
  });

  it('refuses on missing proposedAt', () => {
    const valid = makeValid();
    const { proposedAt: _p, ...bad } = valid;
    const parsed = parseBytesPackage(bad as unknown);
    expect(parsed.ok).toBe(false);
  });

  it('refuses on garbage non-object input', () => {
    expect(parseBytesPackage('not a json object').ok).toBe(false);
    expect(parseBytesPackage(null).ok).toBe(false);
    expect(parseBytesPackage(undefined).ok).toBe(false);
    expect(parseBytesPackage(42).ok).toBe(false);
    expect(parseBytesPackage([]).ok).toBe(false);
  });

  it('uses a different counterparty address — equivalence check on the validator', () => {
    // Sanity: building with ADDR_OTHER as the proposer is fine, no false
    // negative on otherwise-valid addresses just because they're not
    // ADDR_DEPOSITOR.
    const pkg = buildBytesPackage({
      multisigAddress: ADDR_MULTISIG,
      callHash: SAMPLE_HASH,
      callData: SAMPLE_CALL_BYTES,
      proposedBy: ADDR_OTHER,
      proposedAt: { block: 1, index: 0 },
    });
    const parsed = parseBytesPackage(pkg as unknown);
    expect(parsed.ok).toBe(true);
  });
});
