/**
 * Tests for parseOpenTip — the tips pallet OpenTip decoder.
 *
 * OpenTip's named fields are read directly (`tip.who`, `tip.finder`,
 * `tip.deposit`, `tip.closes`, `tip.tips`) — decode enums via
 * .toJSON()/named fields with a mangle guard (addresses start with '6'),
 * since auto-derived .isFoo/.asFoo accessors and tuple destructure are
 * unreliable on the xx runtime. The endorser sum is computed by iterating
 * `tip.tips: Vec<(AccountId, Balance)>` — that part DOES use array
 * destructure because each entry is a real tuple, not a struct.
 *
 * Tests use plain JS object stubs since the chain has 0 tips at
 * observation; we can't verify against a live fixture.
 */

import { describe, expect, it } from 'vitest';
import { BN } from '@polkadot/util';
import { parseOpenTip } from './useTips';

const WHO = '6YDEf5Q78EFHbmiJRFqfpNpiGQjMZf1Cqpy2Dmi8FRYJVTCQ';
const FINDER = '6WhoHGAWQHZUGoYew3KwA18pEPVBmzLnfbhZmXp5oEqMouJf';
const ENDORSER_1 = '6Vcqq5SoUTRY2ZZ361BVfASa9RGkYiAa7Pj17qjMCoLCyDd4';
const ENDORSER_2 = '6WSH4iFzYY3ATabSuQwSaaacFLs9JVAhH7R3xAFf1UyWoEsH';

const HASH = '0xfeed1234abcd' + '0'.repeat(52);

const stubAccount = (s: string) => ({ toString: () => s });
const stubBalance = (raw: string) => ({ toBn: () => new BN(raw) });
const stubKey = (hash: string) => ({ args: [{ toHex: () => hash }] });

describe('parseOpenTip — happy path with endorsers', () => {
  it('extracts who + finder + deposit + endorsements + closesAt', () => {
    const key = stubKey(HASH);
    const tip = {
      who: stubAccount(WHO),
      finder: stubAccount(FINDER),
      deposit: stubBalance('1000000000'),
      tips: [
        [stubAccount(ENDORSER_1), stubBalance('5000000000')],
        [stubAccount(ENDORSER_2), stubBalance('7500000000')],
      ],
      closes: { isSome: true, unwrap: () => ({ toNumber: () => 24_000_000 }) },
    };
    const r = parseOpenTip(key, tip);
    expect(r).not.toBeNull();
    expect(r?.hash).toBe(HASH);
    expect(r?.who).toBe(WHO);
    expect(r?.finder).toBe(FINDER);
    expect(r?.deposit?.toString()).toBe('1000000000');
    expect(r?.endorserCount).toBe(2);
    expect(r?.endorsementSum?.toString()).toBe('12500000000');
    expect(r?.closesAt).toBe(24_000_000);
  });

  it('handles closes: None correctly (threshold not yet crossed)', () => {
    const tip = {
      who: stubAccount(WHO),
      finder: stubAccount(FINDER),
      deposit: stubBalance('1000000000'),
      tips: [],
      closes: { isSome: false },
    };
    const r = parseOpenTip(stubKey(HASH), tip);
    expect(r?.closesAt).toBeNull();
    expect(r?.endorserCount).toBe(0);
    expect(r?.endorsementSum).toBeNull();
  });
});

describe('parseOpenTip — mangle guard', () => {
  it('returns null when who toString yields a non-SS58 string', () => {
    const tip = {
      who: stubAccount('who,6YDEf…VTCQ'),
      finder: stubAccount(FINDER),
      deposit: stubBalance('1'),
      tips: [],
      closes: { isSome: false },
    };
    expect(parseOpenTip(stubKey(HASH), tip)).toBeNull();
  });

  it('returns null when finder toString yields a non-SS58 string', () => {
    const tip = {
      who: stubAccount(WHO),
      finder: stubAccount('finder,6Who…ouJf'),
      deposit: stubBalance('1'),
      tips: [],
      closes: { isSome: false },
    };
    expect(parseOpenTip(stubKey(HASH), tip)).toBeNull();
  });
});

describe('parseOpenTip — defensive', () => {
  it('returns null for missing fields', () => {
    expect(parseOpenTip(stubKey(HASH), null)).toBeNull();
    expect(parseOpenTip(stubKey(HASH), {})).toBeNull();
  });

  it('returns null when key.args[0].toHex is missing', () => {
    expect(
      parseOpenTip(
        { args: [{}] },
        {
          who: stubAccount(WHO),
          finder: stubAccount(FINDER),
          deposit: stubBalance('1'),
          tips: [],
          closes: { isSome: false },
        }
      )
    ).toBeNull();
  });

  it('skips malformed endorsement entries silently', () => {
    const tip = {
      who: stubAccount(WHO),
      finder: stubAccount(FINDER),
      deposit: stubBalance('1'),
      tips: [
        [stubAccount(ENDORSER_1), stubBalance('5000000000')], // good
        null, // bad
        [stubAccount(ENDORSER_2), { weird: 'shape' }], // bad balance
      ],
      closes: { isSome: false },
    };
    const r = parseOpenTip(stubKey(HASH), tip);
    expect(r?.endorserCount).toBe(1);
    expect(r?.endorsementSum?.toString()).toBe('5000000000');
  });
});
