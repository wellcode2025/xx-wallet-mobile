/**
 * Tests for the propose-referendum helpers (pure logic). blake2 needs the
 * wasm crypto initialised — same beforeAll pattern as the keystore tests.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { BN } from '@polkadot/util';
import { blake2AsU8a, cryptoWaitReady } from '@polkadot/util-crypto';
import {
  boundedFor,
  validatePropose,
  INLINE_BOUND_BYTES,
} from './proposeReferendum';

beforeAll(async () => {
  await cryptoWaitReady();
});

const XX = (n: number) => new BN(Math.round(n * 1e9).toString());

describe('boundedFor', () => {
  it('small calls are Inline (single tx, no preimage)', () => {
    expect(boundedFor(new Uint8Array(1))).toEqual({ kind: 'inline' });
    expect(boundedFor(new Uint8Array(INLINE_BOUND_BYTES))).toEqual({ kind: 'inline' });
  });

  it('larger calls are Lookup with blake2_256 hash + length', () => {
    const bytes = new Uint8Array(INLINE_BOUND_BYTES + 1).fill(7);
    const shape = boundedFor(bytes);
    expect(shape.kind).toBe('lookup');
    if (shape.kind === 'lookup') {
      expect(shape.len).toBe(bytes.length);
      expect(shape.hash).toEqual(blake2AsU8a(bytes, 256));
    }
  });
});

describe('validatePropose', () => {
  const base = {
    hasCall: true,
    callDecodes: true,
    deposit: XX(100),
    minDeposit: XX(100),
    available: XX(1000),
  };

  it('accepts a decodable call with the minimum deposit', () => {
    expect(validatePropose(base)).toEqual({ ok: true });
  });

  it('requires call bytes', () => {
    expect(validatePropose({ ...base, hasCall: false })).toEqual({
      ok: false,
      error: 'call-required',
    });
  });

  it('refuses bytes the wallet cannot decode (§6.4 discipline)', () => {
    expect(validatePropose({ ...base, callDecodes: false })).toEqual({
      ok: false,
      error: 'call-undecodable',
    });
  });

  it('requires a deposit at or above the chain minimum', () => {
    expect(validatePropose({ ...base, deposit: null })).toEqual({
      ok: false,
      error: 'deposit-required',
    });
    expect(validatePropose({ ...base, deposit: XX(99.999) })).toEqual({
      ok: false,
      error: 'deposit-below-minimum',
    });
  });

  it('rejects a deposit beyond the available balance', () => {
    expect(validatePropose({ ...base, deposit: XX(2000) })).toEqual({
      ok: false,
      error: 'insufficient-balance',
    });
  });
});
