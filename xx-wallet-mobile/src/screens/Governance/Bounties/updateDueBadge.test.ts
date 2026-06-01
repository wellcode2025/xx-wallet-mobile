/**
 * Tests for updateDueBadge — the threshold mapping from block-delta
 * to a colored chip kind.
 *
 * Thresholds:
 *   red    — isOverdue (target ≤ current)
 *   amber  — 0 < remaining < 7 days
 *   green  — remaining ≥ 7 days
 *
 * xx block time is 6 s, so 7 days = 100,800 blocks.
 */

import { describe, expect, it } from 'vitest';
import { updateDueBadge } from './updateDueBadge';

const ONE_DAY_BLOCKS = 14_400;
const SEVEN_DAYS_BLOCKS = 7 * ONE_DAY_BLOCKS;

describe('updateDueBadge — color tiers', () => {
  it('returns red "Update overdue" when target is past', () => {
    const r = updateDueBadge(100, 50);
    expect(r.kind).toBe('red');
    expect(r.label).toBe('Update overdue');
  });

  it('returns red even at exactly current block (zero delta = past)', () => {
    const r = updateDueBadge(100, 100);
    expect(r.kind).toBe('red');
    expect(r.label).toBe('Update overdue');
  });

  it('returns amber for a 6-day-ahead target', () => {
    const r = updateDueBadge(0, 6 * ONE_DAY_BLOCKS);
    expect(r.kind).toBe('amber');
    expect(r.label).toBe('6 days');
  });

  it('returns amber at the upper edge — just under 7 days', () => {
    // 7 days minus one block — still under the threshold.
    const r = updateDueBadge(0, SEVEN_DAYS_BLOCKS - 1);
    expect(r.kind).toBe('amber');
  });

  it('returns green at exactly 7 days', () => {
    const r = updateDueBadge(0, SEVEN_DAYS_BLOCKS);
    expect(r.kind).toBe('green');
    expect(r.label).toBe('7 days');
  });

  it('returns green for the bounty #7 fixture (29 days 3 hrs ahead)', () => {
    const HEAD = 23_512_817;
    const BOUNTY_7_UPDATE_DUE = 23_932_462;
    const r = updateDueBadge(HEAD, BOUNTY_7_UPDATE_DUE);
    expect(r.kind).toBe('green');
    expect(r.label).toBe('29 days 3 hrs');
  });

  it('returns red "Update overdue" for the bounty #5 fixture (~178 days overdue)', () => {
    const HEAD = 23_512_817;
    const BOUNTY_5_UPDATE_DUE = 20_912_532;
    const r = updateDueBadge(HEAD, BOUNTY_5_UPDATE_DUE);
    expect(r.kind).toBe('red');
    expect(r.label).toBe('Update overdue');
  });
});

describe('updateDueBadge — null inputs', () => {
  it('returns "none" placeholder when currentBlock is null', () => {
    const r = updateDueBadge(null, 100);
    expect(r.kind).toBe('none');
    expect(r.label).toBe('—');
  });

  it('returns "none" placeholder when targetBlock is undefined', () => {
    const r = updateDueBadge(100, undefined);
    expect(r.kind).toBe('none');
  });
});
