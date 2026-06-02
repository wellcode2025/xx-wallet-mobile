import { describe, it, expect } from 'vitest';
import BigNumber from 'bignumber.js';
import {
  applyQualityLevers,
  countSelectionChanges,
  leversActiveCount,
  DEFAULT_LEVERS,
} from './qualityLevers';
import type { AutoNominateValidator } from './selectValidators';

/** Build a validator with sensible defaults; override what a test cares about. */
function mk(
  id: string,
  over: Partial<AutoNominateValidator> = {}
): AutoNominateValidator {
  return {
    validatorId: id,
    backedStake: new BigNumber(0),
    score: new BigNumber(0),
    backers: 10,
    return: 1,
    commission: 10,
    hasIdentity: false,
    displayName: null,
    blocked: false,
    ...over,
  };
}

describe('applyQualityLevers', () => {
  it('with default levers, ranks by return and drops blocked + oversubscribed', () => {
    const all = [
      mk('A', { return: 3 }),
      mk('B', { return: 5 }),
      mk('C', { return: 9, blocked: true }), // excluded: blocked
      mk('D', { return: 8, backers: 256 }), // excluded: at cap
      mk('E', { return: 4 }),
    ];
    const out = applyQualityLevers(all, DEFAULT_LEVERS, 3).map(
      (v) => v.validatorId
    );
    expect(out).toEqual(['B', 'E', 'A']); // 5, 4, 3 — C and D filtered out
  });

  it('preferIdentity boosts identified validators above the base order', () => {
    const all = [
      mk('top', { return: 1.0, hasIdentity: false }),
      mk('id', { return: 0.85, hasIdentity: true }), // 0.85 × 1.25 = 1.0625 > 1.0
    ];
    const base = applyQualityLevers(all, DEFAULT_LEVERS, 2).map(
      (v) => v.validatorId
    );
    expect(base[0]).toBe('top');
    const biased = applyQualityLevers(
      all,
      { ...DEFAULT_LEVERS, preferIdentity: true },
      2
    ).map((v) => v.validatorId);
    expect(biased[0]).toBe('id');
  });

  it('maxCommission excludes validators above the cap', () => {
    const all = [
      mk('cheap', { return: 1, commission: 5 }),
      mk('mid', { return: 9, commission: 18 }),
      mk('dear', { return: 99, commission: 25 }),
    ];
    const out = applyQualityLevers(
      all,
      { ...DEFAULT_LEVERS, maxCommission: 20 },
      16
    ).map((v) => v.validatorId);
    expect(out).toEqual(['mid', 'cheap']); // 'dear' (25%) filtered; mid>cheap by return
  });

  it('preferLessSaturated favours fewer-backer validators', () => {
    const all = [
      mk('busy', { return: 1.0, backers: 250 }),
      mk('quiet', { return: 0.8, backers: 0 }), // 0.8 × (1 + 0.5) = 1.2 > ~1.0
    ];
    const biased = applyQualityLevers(
      all,
      { ...DEFAULT_LEVERS, preferLessSaturated: true },
      2
    ).map((v) => v.validatorId);
    expect(biased[0]).toBe('quiet');
  });
});

describe('countSelectionChanges', () => {
  it('counts picks not present in the base set', () => {
    const base = [mk('A'), mk('B'), mk('C')];
    const next = [mk('A'), mk('X'), mk('Y')];
    expect(countSelectionChanges(next, base)).toBe(2); // X, Y are new
  });
});

describe('leversActiveCount', () => {
  it('counts active levers', () => {
    expect(leversActiveCount(DEFAULT_LEVERS)).toBe(0);
    expect(
      leversActiveCount({
        preferIdentity: true,
        preferLessSaturated: false,
        maxCommission: 20,
      })
    ).toBe(2);
  });
});
