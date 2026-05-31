/**
 * Tests for parseProposal — the treasury Proposal decoder.
 *
 * Per feedback_chain_enum_decoding, fields are read by name (not by
 * array destructure). The mangle guard rejects entries where the
 * proposer or beneficiary doesn't look like an xx SS58 address, so a
 * future regression of the Slice 3.1 class renders an empty row
 * rather than garbage.
 *
 * Tests stub the chain codec with plain JS objects whose .toString /
 * .toBn / .toNumber match what polkadot-codec returns for a real
 * Proposal struct.
 */

import { describe, expect, it } from 'vitest';
import { BN } from '@polkadot/util';
import { parseProposal } from './useTreasury';

const PROPOSER = '6YDEf5Q78EFHbmiJRFqfpNpiGQjMZf1Cqpy2Dmi8FRYJVTCQ';
const BENEFICIARY = '6WhoHGAWQHZUGoYew3KwA18pEPVBmzLnfbhZmXp5oEqMouJf';

const stubAccount = (s: string) => ({ toString: () => s });
const stubBalance = (raw: string) => ({ toBn: () => new BN(raw) });
const stubKey = (id: number) => ({
  args: [{ toNumber: () => id }],
});

describe('parseProposal — happy path', () => {
  it('extracts all four fields from a Proposal struct', () => {
    const key = stubKey(7);
    const prop = {
      proposer: stubAccount(PROPOSER),
      value: stubBalance('1500000000000000'),
      beneficiary: stubAccount(BENEFICIARY),
      bond: stubBalance('75000000000000'),
    };
    const r = parseProposal(key, prop);
    expect(r).not.toBeNull();
    expect(r?.id).toBe(7);
    expect(r?.proposer).toBe(PROPOSER);
    expect(r?.value.toString()).toBe('1500000000000000');
    expect(r?.beneficiary).toBe(BENEFICIARY);
    expect(r?.bond.toString()).toBe('75000000000000');
  });
});

describe('parseProposal — mangle guard', () => {
  it('returns null when proposer toString yields a non-SS58 string', () => {
    const prop = {
      proposer: stubAccount('proposer,6YDEf…VTCQ'),
      value: stubBalance('1'),
      beneficiary: stubAccount(BENEFICIARY),
      bond: stubBalance('1'),
    };
    expect(parseProposal(stubKey(1), prop)).toBeNull();
  });

  it('returns null when beneficiary toString yields a non-SS58 string', () => {
    const prop = {
      proposer: stubAccount(PROPOSER),
      value: stubBalance('1'),
      beneficiary: stubAccount('beneficiary,6Who…ouJf'),
      bond: stubBalance('1'),
    };
    expect(parseProposal(stubKey(1), prop)).toBeNull();
  });
});

describe('parseProposal — defensive', () => {
  it('returns null for missing fields', () => {
    expect(parseProposal(stubKey(1), { proposer: stubAccount(PROPOSER) })).toBeNull();
    expect(parseProposal(stubKey(1), null)).toBeNull();
  });

  it('returns null when key.args[0].toNumber is missing', () => {
    expect(
      parseProposal(
        { args: [{}] },
        {
          proposer: stubAccount(PROPOSER),
          value: stubBalance('1'),
          beneficiary: stubAccount(BENEFICIARY),
          bond: stubBalance('1'),
        }
      )
    ).toBeNull();
  });

  it('returns null when value or bond lacks toBn', () => {
    const prop = {
      proposer: stubAccount(PROPOSER),
      value: { weird: 'shape' },
      beneficiary: stubAccount(BENEFICIARY),
      bond: stubBalance('1'),
    };
    expect(parseProposal(stubKey(1), prop)).toBeNull();
  });

  it("returns null when toString throws", () => {
    const prop = {
      proposer: {
        toString: () => {
          throw new Error('boom');
        },
      },
      value: stubBalance('1'),
      beneficiary: stubAccount(BENEFICIARY),
      bond: stubBalance('1'),
    };
    expect(parseProposal(stubKey(1), prop)).toBeNull();
  });
});
