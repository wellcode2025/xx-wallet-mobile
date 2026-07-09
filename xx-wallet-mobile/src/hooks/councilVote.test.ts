/**
 * Tests for the council-vote math + validation (pure logic).
 * Mainnet constants (spiked 2026-07-08): base 20.064 XX, factor 0.032 XX.
 */
import { describe, expect, it } from 'vitest';
import { BN } from '@polkadot/util';
import {
  additionalBond,
  councilVoteBond,
  validateCouncilVote,
  MAX_COUNCIL_VOTES,
} from './councilVote';

const XX = (n: number) => new BN(Math.round(n * 1e9).toString()); // 9 decimals

describe('councilVoteBond', () => {
  const base = XX(20.064);
  const factor = XX(0.032);

  it('is base + factor per vote (mainnet numbers)', () => {
    expect(councilVoteBond(base, factor, 1).toString()).toBe(XX(20.096).toString());
    expect(councilVoteBond(base, factor, 16).toString()).toBe(XX(20.576).toString());
  });

  it('clamps a negative count to base', () => {
    expect(councilVoteBond(base, factor, -3).toString()).toBe(base.toString());
  });
});

describe('additionalBond', () => {
  it('is the full bond for a first-time voter', () => {
    expect(additionalBond(XX(20.096), null).toString()).toBe(XX(20.096).toString());
  });

  it('is only the top-up when re-voting with more candidates', () => {
    expect(additionalBond(XX(20.576), XX(20.096)).toString()).toBe(XX(0.48).toString());
  });

  it('is zero when re-voting with fewer candidates (pallet refunds)', () => {
    expect(additionalBond(XX(20.096), XX(20.576)).toString()).toBe('0');
  });
});

describe('validateCouncilVote', () => {
  const base = {
    stake: XX(100),
    available: XX(1000),
    newBond: XX(20.096),
    existingDeposit: null as BN | null,
  };

  it('accepts a normal first vote', () => {
    expect(validateCouncilVote({ ...base, selectedCount: 1 })).toEqual({ ok: true });
  });

  it('rejects zero candidates', () => {
    expect(validateCouncilVote({ ...base, selectedCount: 0 })).toEqual({
      ok: false,
      error: 'no-candidates',
    });
  });

  it('rejects more than the per-voter cap', () => {
    expect(
      validateCouncilVote({ ...base, selectedCount: MAX_COUNCIL_VOTES + 1 })
    ).toEqual({ ok: false, error: 'too-many-candidates' });
  });

  it('rejects a missing or zero stake', () => {
    expect(validateCouncilVote({ ...base, selectedCount: 1, stake: null })).toEqual({
      ok: false,
      error: 'stake-required',
    });
    expect(
      validateCouncilVote({ ...base, selectedCount: 1, stake: new BN(0) })
    ).toEqual({ ok: false, error: 'stake-required' });
  });

  it('rejects a stake at or below the existential deposit (elections.LowBalance)', () => {
    const ed = XX(1);
    expect(
      validateCouncilVote({ ...base, selectedCount: 1, stake: XX(1), minStake: ed })
    ).toEqual({ ok: false, error: 'stake-below-minimum' });
    expect(
      validateCouncilVote({ ...base, selectedCount: 1, stake: XX(1.5), minStake: ed })
    ).toEqual({ ok: true });
  });

  it('rejects stake + bond exceeding available', () => {
    expect(
      validateCouncilVote({
        ...base,
        selectedCount: 1,
        stake: XX(990),
        available: XX(1000),
      })
    ).toEqual({ ok: false, error: 'insufficient-balance' });
  });

  it('counts only the bond TOP-UP against balance when re-voting', () => {
    // Stake 990 + full bond 20.096 would fail, but with an existing 20.096
    // deposit the top-up is zero, so it passes.
    expect(
      validateCouncilVote({
        ...base,
        selectedCount: 1,
        stake: XX(990),
        available: XX(1000),
        existingDeposit: XX(20.096),
      })
    ).toEqual({ ok: true });
  });
});
