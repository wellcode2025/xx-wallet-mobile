/**
 * Tests for parseStakedEntry — the elections-pallet list decoder.
 *
 * Background: Slice 3 shipped with `decodeStakedList` assuming
 * elections.members returns Vec<(AccountId, Balance)> tuples. On the
 * xx mainnet v206 runtime it actually returns Vec<SeatHolder>, a
 * struct with named fields {who, stake, deposit}. The destructure
 * `[acc, bal] = entry` walked the struct's *field-name pairs* instead
 * of its values, so `acc.toString()` produced "who,6Va…fTVT" instead
 * of "6Va…fTVT" and every Council Members row rendered as a mangled
 * string. Caught on phone-test.
 *
 * Fix accepts both the modern SeatHolder struct and the legacy tuple
 * shape on the same code path. Tests pin down both shapes plus the
 * mangle-detection guard (returns null for addresses that don't
 * start with "6", catching any future regression of the same kind).
 */

import { describe, expect, it } from 'vitest';
import { BN } from '@polkadot/util';
import { parseStakedEntry } from './useCouncil';

const ADDR_1 = '6VaNn3ntdFWQWysscqt2bxDtqKBkeKqFvnzgYATQAytefTVT';
const ADDR_2 = '6WhoHGAWQHZUGoYew3KwA18pEPVBmzLnfbhZmXp5oEqMouJf';

const stubAccount = (s: string) => ({ toString: () => s });
const stubBalance = (raw: string) => ({
  toBn: () => new BN(raw),
});

describe('parseStakedEntry — modern SeatHolder struct shape', () => {
  it('extracts who + stake from a struct with toString accessor', () => {
    const entry = {
      who: stubAccount(ADDR_1),
      stake: stubBalance('9979700000000'),
      deposit: stubBalance('20064000000'),
    };
    const r = parseStakedEntry(entry);
    expect(r).not.toBeNull();
    expect(r?.address).toBe(ADDR_1);
    expect(r?.stake?.toString()).toBe('9979700000000');
  });

  it('handles a struct whose stake is missing the toBn accessor', () => {
    const entry = {
      who: stubAccount(ADDR_2),
      stake: { weird: 'shape' },
    };
    const r = parseStakedEntry(entry);
    expect(r).not.toBeNull();
    expect(r?.address).toBe(ADDR_2);
    expect(r?.stake).toBeNull();
  });
});

describe('parseStakedEntry — legacy tuple shape', () => {
  it('extracts account + balance from a [AccountId, Balance] tuple', () => {
    const entry = [stubAccount(ADDR_1), stubBalance('100000000000')];
    const r = parseStakedEntry(entry);
    expect(r).not.toBeNull();
    expect(r?.address).toBe(ADDR_1);
    expect(r?.stake?.toString()).toBe('100000000000');
  });
});

describe('parseStakedEntry — mangle guard', () => {
  it('returns null when the SeatHolder `who` field yields a non-SS58 string', () => {
    // This is what the Slice 3 bug looked like — the destructure of a
    // struct's field-name pair gave us toString() = "who,6Va…fTVT" instead
    // of the address. The guard catches it so a future regression renders
    // an empty row rather than garbage.
    const entry = {
      who: stubAccount('who,6VaNn3ntdFWQ…fTVT'),
      stake: stubBalance('1'),
    };
    expect(parseStakedEntry(entry)).toBeNull();
  });

  it('returns null when a tuple\'s accCodec yields a non-SS58 string', () => {
    const entry = [stubAccount('garbage,6VaNn…'), stubBalance('1')];
    expect(parseStakedEntry(entry)).toBeNull();
  });
});

describe('parseStakedEntry — defensive paths', () => {
  it('returns null for null/undefined entry', () => {
    expect(parseStakedEntry(null)).toBeNull();
    expect(parseStakedEntry(undefined)).toBeNull();
  });

  it('returns null when neither struct nor tuple shape is present', () => {
    expect(parseStakedEntry({ randomKey: 'value' })).toBeNull();
  });

  it('returns null when toString throws', () => {
    const entry = {
      who: {
        toString: () => {
          throw new Error('codec deserialization failure');
        },
      },
      stake: stubBalance('1'),
    };
    expect(parseStakedEntry(entry)).toBeNull();
  });
});
