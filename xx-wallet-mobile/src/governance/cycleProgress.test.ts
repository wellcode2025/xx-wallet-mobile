/**
 * Tests for cycleProgress — the generalized period-progress helper.
 *
 * Generalised from the per-screen launchProgress that originally
 * shipped with Slice 2. Same math; the only addition is a noun param
 * that gets baked into the label ("X until next launch" / "election" /
 * "spend" / etc.). All the Slice 2 cases still hold; new cases here
 * cover the noun substitution and the council-term scenario for Slice 3.
 */

import { describe, expect, it } from 'vitest';
import { cycleProgress } from './cycleProgress';

const LAUNCH = 100_800; // democracy.launchPeriod on xx (= elections.termDuration)

describe('cycleProgress — happy path', () => {
  it('mid-cycle: half way through cycle 0 reports 50% and cycle 0', () => {
    const r = cycleProgress(LAUNCH / 2, LAUNCH, 'launch');
    expect(r.cycle).toBe(0);
    expect(r.positionInCycle).toBe(LAUNCH / 2);
    expect(r.progressPct).toBe(50);
    expect(r.nextEventBlock).toBe(LAUNCH);
    expect(r.remainingLabel).toContain('until next launch');
  });

  it('exactly on a tick: position 0, progress 0, next tick a full period away', () => {
    const r = cycleProgress(LAUNCH, LAUNCH, 'launch');
    expect(r.cycle).toBe(1);
    expect(r.positionInCycle).toBe(0);
    expect(r.progressPct).toBe(0);
    expect(r.nextEventBlock).toBe(2 * LAUNCH);
  });

  it('one block before a tick: position = period - 1, near 100%', () => {
    const r = cycleProgress(LAUNCH - 1, LAUNCH, 'launch');
    expect(r.cycle).toBe(0);
    expect(r.positionInCycle).toBe(LAUNCH - 1);
    expect(r.progressPct).toBeGreaterThan(99.99);
    expect(r.progressPct).toBeLessThan(100);
    expect(r.nextEventBlock).toBe(LAUNCH);
  });

  it('many cycles in: live-chain-ish position computes correct cycle index', () => {
    const head = 23_512_817;
    const r = cycleProgress(head, LAUNCH, 'launch');
    expect(r.cycle).toBe(Math.floor(head / LAUNCH));
    expect(r.positionInCycle).toBe(head % LAUNCH);
    expect(r.nextEventBlock).toBe((r.cycle + 1) * LAUNCH);
  });
});

describe('cycleProgress — noun substitution', () => {
  it('uses the supplied noun for the label suffix', () => {
    const r = cycleProgress(LAUNCH / 2, LAUNCH, 'launch');
    expect(r.remainingLabel.endsWith(' until next launch')).toBe(true);
  });

  it('council use case: "until next election"', () => {
    const r = cycleProgress(LAUNCH / 2, LAUNCH, 'election');
    expect(r.remainingLabel.endsWith(' until next election')).toBe(true);
  });

  it('treasury use case: "until next spend"', () => {
    // Treasury spend period is 345,600 blocks (~24 days).
    const r = cycleProgress(345_600 / 2, 345_600, 'spend');
    expect(r.remainingLabel.endsWith(' until next spend')).toBe(true);
  });
});

describe('cycleProgress — edge cases', () => {
  it('returns the placeholder when period is 0', () => {
    const r = cycleProgress(100, 0, 'launch');
    expect(r.cycle).toBe(0);
    expect(r.positionInCycle).toBe(0);
    expect(r.remainingLabel).toBe('—');
    expect(r.progressPct).toBe(0);
  });

  it('clamps progressPct into [0, 100] defensively', () => {
    const r = cycleProgress(-50, LAUNCH, 'launch');
    expect(r.progressPct).toBeGreaterThanOrEqual(0);
    expect(r.progressPct).toBeLessThanOrEqual(100);
  });
});
