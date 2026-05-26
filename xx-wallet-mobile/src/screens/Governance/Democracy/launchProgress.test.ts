/**
 * Tests for launchProgress — the launch-period countdown helper.
 *
 * xx's launchPeriod is 100,800 blocks (≈7 days at 6 s / block). The
 * pattern is straightforward but has the classic off-by-one in the
 * "we just hit a launch tick" case, which is the main thing this
 * suite pins down.
 */

import { describe, expect, it } from 'vitest';
import { launchProgress } from './launchProgress';

const LAUNCH = 100_800;

describe('launchProgress — happy path', () => {
  it('mid-cycle: half way through cycle 0 reports 50% and cycle 0', () => {
    const r = launchProgress(LAUNCH / 2, LAUNCH);
    expect(r.cycle).toBe(0);
    expect(r.positionInCycle).toBe(LAUNCH / 2);
    expect(r.progressPct).toBe(50);
    expect(r.nextLaunchBlock).toBe(LAUNCH);
    expect(r.remainingLabel).toContain('until next launch');
  });

  it('exactly on a tick: position 0, progress 0, next tick a full period away', () => {
    const r = launchProgress(LAUNCH, LAUNCH);
    expect(r.cycle).toBe(1);
    expect(r.positionInCycle).toBe(0);
    expect(r.progressPct).toBe(0);
    expect(r.nextLaunchBlock).toBe(2 * LAUNCH);
  });

  it('one block before a tick: position = launchPeriod - 1, near 100%', () => {
    const r = launchProgress(LAUNCH - 1, LAUNCH);
    expect(r.cycle).toBe(0);
    expect(r.positionInCycle).toBe(LAUNCH - 1);
    expect(r.progressPct).toBeGreaterThan(99.99);
    expect(r.progressPct).toBeLessThan(100);
    expect(r.nextLaunchBlock).toBe(LAUNCH);
  });

  it('many cycles in: live-chain-ish position computes correct cycle index', () => {
    // Block ≈ 23,500,000 is the spike-observed head; with launchPeriod
    // 100,800 that's ~233 cycles into the chain's life.
    const head = 23_512_817;
    const r = launchProgress(head, LAUNCH);
    expect(r.cycle).toBe(Math.floor(head / LAUNCH));
    expect(r.positionInCycle).toBe(head % LAUNCH);
    expect(r.nextLaunchBlock).toBe((r.cycle + 1) * LAUNCH);
  });
});

describe('launchProgress — edge cases', () => {
  it('returns the placeholder when launchPeriod is 0', () => {
    const r = launchProgress(100, 0);
    expect(r.cycle).toBe(0);
    expect(r.positionInCycle).toBe(0);
    expect(r.remainingLabel).toBe('—');
    expect(r.progressPct).toBe(0);
  });

  it('clamps progressPct into [0, 100] defensively', () => {
    // Negative current block (defensive — wouldn't happen but the
    // clamp must hold). Math.floor of a negative number rounds away
    // from zero so cycle becomes -1, position becomes positive.
    const r = launchProgress(-50, LAUNCH);
    expect(r.progressPct).toBeGreaterThanOrEqual(0);
    expect(r.progressPct).toBeLessThanOrEqual(100);
  });
});
