/**
 * Tests for the AccountVote encoder / decoder / vote-weight / form
 * validation helpers.
 *
 * Round-trip: encodeVoteByte → decodeVoteByte must return the original
 * (aye, conviction) pair for all 14 combinations (2 × 7). This is the
 * load-bearing test because parseMyVoting and the encoder have to agree
 * byte-for-byte.
 */

import { describe, expect, it } from 'vitest';
import { BN } from '@polkadot/util';
import {
  CONVICTIONS,
  convictionMultiplier,
  decodeVoteByte,
  encodeVoteByte,
  validateVoteInputs,
  voteWeight,
  type ConvictionId,
} from './accountVote';

describe('encodeVoteByte', () => {
  it('sets bit 0x80 for aye', () => {
    expect(encodeVoteByte(true, 0)).toBe(0x80);
    expect(encodeVoteByte(true, 1)).toBe(0x81);
  });

  it('leaves bit 0x80 unset for nay', () => {
    expect(encodeVoteByte(false, 0)).toBe(0x00);
    expect(encodeVoteByte(false, 3)).toBe(0x03);
  });

  it('encodes conviction in the low nibble', () => {
    expect(encodeVoteByte(true, 6)).toBe(0x86);
    expect(encodeVoteByte(false, 6)).toBe(0x06);
  });

  it('throws on out-of-range conviction', () => {
    expect(() =>
      encodeVoteByte(true, 7 as unknown as ConvictionId)
    ).toThrow(/conviction must be an integer 0-6/);
    expect(() =>
      encodeVoteByte(true, -1 as unknown as ConvictionId)
    ).toThrow();
  });
});

describe('decodeVoteByte', () => {
  it('decodes 0x81 as aye + conviction 1', () => {
    expect(decodeVoteByte(0x81)).toEqual({ aye: true, conviction: 1 });
  });

  it('decodes 0x03 as nay + conviction 3', () => {
    expect(decodeVoteByte(0x03)).toEqual({ aye: false, conviction: 3 });
  });

  it('throws on a conviction id > 6 packed in the byte', () => {
    expect(() => decodeVoteByte(0x87)).toThrow(/invalid conviction id 7/);
    expect(() => decodeVoteByte(0x0f)).toThrow(/invalid conviction id 15/);
  });
});

describe('encode → decode round-trip', () => {
  it('all 14 aye × conviction combinations round-trip identically', () => {
    for (const conv of CONVICTIONS) {
      for (const aye of [true, false]) {
        const byte = encodeVoteByte(aye, conv.id as ConvictionId);
        const decoded = decodeVoteByte(byte);
        expect(decoded.aye).toBe(aye);
        expect(decoded.conviction).toBe(conv.id);
      }
    }
  });
});

describe('voteWeight', () => {
  it('returns balance / 10 for None conviction', () => {
    expect(voteWeight(new BN(1000), 0).toString()).toBe('100');
    expect(voteWeight(new BN(999), 0).toString()).toBe('99'); // floor
  });

  it('returns balance × N for Locked Nx conviction', () => {
    expect(voteWeight(new BN(1000), 1).toString()).toBe('1000');
    expect(voteWeight(new BN(1000), 2).toString()).toBe('2000');
    expect(voteWeight(new BN(1000), 6).toString()).toBe('6000');
  });

  it('multiplier table is in lockstep with voteWeight', () => {
    for (const conv of CONVICTIONS) {
      const expected = conv.multiplier;
      expect(convictionMultiplier(conv.id as ConvictionId)).toBe(expected);
    }
  });
});

describe('validateVoteInputs', () => {
  const ok = (over: Partial<Parameters<typeof validateVoteInputs>[0]> = {}) => ({
    balance: new BN(500),
    available: new BN(1000),
    conviction: 1 as ConvictionId,
    refIndex: 0,
    ...over,
  });

  it('returns ok for valid inputs', () => {
    expect(validateVoteInputs(ok())).toEqual({ ok: true });
  });

  it('rejects zero balance', () => {
    expect(validateVoteInputs(ok({ balance: new BN(0) }))).toEqual({
      ok: false,
      error: 'balance-required',
    });
  });

  it('rejects balance > available', () => {
    expect(
      validateVoteInputs(ok({ balance: new BN(1001), available: new BN(1000) }))
    ).toEqual({ ok: false, error: 'balance-exceeds-available' });
  });

  it('rejects out-of-range conviction', () => {
    expect(
      validateVoteInputs(ok({ conviction: 7 as unknown as ConvictionId }))
    ).toEqual({ ok: false, error: 'conviction-out-of-range' });
  });

  it('rejects negative refIndex', () => {
    expect(validateVoteInputs(ok({ refIndex: -1 }))).toEqual({
      ok: false,
      error: 'ref-index-invalid',
    });
  });

  it('rejects refIndex above u32::MAX', () => {
    expect(
      validateVoteInputs(ok({ refIndex: 0x1_0000_0000 }))
    ).toEqual({ ok: false, error: 'ref-index-invalid' });
  });
});
