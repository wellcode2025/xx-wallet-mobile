/**
 * Tests for governanceTimer's blocksToHuman.
 *
 * Verifies the format matches the official xx web wallet's "29 days 3 hrs"
 * shape, and that overdue/now/edge cases all return sensible labels.
 *
 * Block time is 6 s on xx, so:
 *   1 minute  = 10 blocks
 *   1 hour    = 600 blocks
 *   1 day     = 14,400 blocks
 *   7 days    = 100,800 blocks   (the chain's launchPeriod)
 *   24 days   = 345,600 blocks   (the chain's spendPeriod)
 *   90 days   = 1,296,000 blocks (the chain's bountyUpdatePeriod)
 *
 * Live observation fixtures (observed live on chain at head #23,512,817):
 *   - Bounty #5 updateDue=20,912,532 → past, ~178 days overdue
 *   - Bounty #7 updateDue=23,932,462 → future, ~29 days 3 hrs
 */

import { describe, expect, it } from 'vitest';
import { blocksToHuman } from './timer';

const HEAD = 23_512_817; // observed live on chain
const BOUNTY_5_UPDATE_DUE = 20_912_532; // overdue
const BOUNTY_7_UPDATE_DUE = 23_932_462; // ~29 days 3 hrs ahead

describe('blocksToHuman — future', () => {
  it('formats "29 days 3 hrs" for bounty #7 against the live head', () => {
    const r = blocksToHuman(HEAD, BOUNTY_7_UPDATE_DUE);
    expect(r.isOverdue).toBe(false);
    expect(r.remainingBlocks).toBe(BOUNTY_7_UPDATE_DUE - HEAD);
    expect(r.days).toBe(29);
    expect(r.hours).toBe(3);
    expect(r.label).toBe('29 days 3 hrs');
  });

  it('formats hours+minutes when < 1 day', () => {
    const r = blocksToHuman(0, 600 + 300); // 1 hr 30 min ahead
    expect(r.days).toBe(0);
    expect(r.hours).toBe(1);
    expect(r.minutes).toBe(30);
    expect(r.label).toBe('1 hr 30 min');
  });

  it('formats minutes only when < 1 hour', () => {
    const r = blocksToHuman(0, 250); // 25 min ahead
    expect(r.days).toBe(0);
    expect(r.hours).toBe(0);
    expect(r.minutes).toBe(25);
    expect(r.label).toBe('25 min');
  });

  it('returns "<1 min" for sub-minute futures', () => {
    const r = blocksToHuman(0, 5); // 30 seconds
    expect(r.label).toBe('<1 min');
    expect(r.isOverdue).toBe(false);
  });

  it('singularizes day/hr/min where 1', () => {
    const r = blocksToHuman(0, 14_400 + 600 + 10); // 1 day 1 hr 1 min
    expect(r.label).toBe('1 day 1 hr');
    // Drops "1 min" because the day-level format only includes day+hr
  });

  it('omits hours when exactly 0 hours into a day-level label', () => {
    const r = blocksToHuman(0, 14_400 * 5); // exactly 5 days
    expect(r.label).toBe('5 days');
  });
});

describe('blocksToHuman — overdue', () => {
  it('flags bounty #5 as overdue with a "Past …" label', () => {
    const r = blocksToHuman(HEAD, BOUNTY_5_UPDATE_DUE);
    expect(r.isOverdue).toBe(true);
    expect(r.remainingBlocks).toBeLessThan(0);
    // ~178 days at 6s/block — exact day count depends on the math
    expect(r.days).toBeGreaterThanOrEqual(178);
    expect(r.days).toBeLessThanOrEqual(181);
    expect(r.label.startsWith('Past ')).toBe(true);
  });

  it('a 1-block overdue target labels as "Past <1 min" and flags overdue', () => {
    const r = blocksToHuman(100, 99);
    expect(r.isOverdue).toBe(true);
    expect(r.label).toBe('Past <1 min');
  });
});

describe('blocksToHuman — zero / edge', () => {
  it('"now" when exactly equal blocks', () => {
    const r = blocksToHuman(100, 100);
    expect(r.remainingBlocks).toBe(0);
    expect(r.isOverdue).toBe(true); // <= 0 counts as overdue
    expect(r.label).toBe('now');
  });

  it('returns the "—" placeholder when either block is null/undefined', () => {
    expect(blocksToHuman(null, 100).label).toBe('—');
    expect(blocksToHuman(100, null).label).toBe('—');
    expect(blocksToHuman(undefined, undefined).label).toBe('—');
  });

  it('returns the "—" placeholder for non-finite block numbers', () => {
    expect(blocksToHuman(NaN, 100).label).toBe('—');
    expect(blocksToHuman(100, Infinity).label).toBe('—');
  });
});

describe('blocksToHuman — chain-level periods sanity', () => {
  it('xx launchPeriod (100,800 blocks) renders as "7 days"', () => {
    const r = blocksToHuman(0, 100_800);
    expect(r.days).toBe(7);
    expect(r.hours).toBe(0);
    expect(r.label).toBe('7 days');
  });

  it('xx spendPeriod (345,600 blocks) renders as "24 days"', () => {
    const r = blocksToHuman(0, 345_600);
    expect(r.days).toBe(24);
    expect(r.hours).toBe(0);
    expect(r.label).toBe('24 days');
  });

  it('xx bountyUpdatePeriod (1,296,000 blocks) renders as "90 days"', () => {
    const r = blocksToHuman(0, 1_296_000);
    expect(r.days).toBe(90);
    expect(r.hours).toBe(0);
    expect(r.label).toBe('90 days');
  });
});
