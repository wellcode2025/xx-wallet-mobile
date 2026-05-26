/**
 * launchProgress — pure math for the Democracy screen's launch-period
 * countdown bar.
 *
 * Substrate's democracy pallet ticks a new launch every `launchPeriod`
 * blocks (`launchPeriod = 100_800` ≈ 7 days on xx). At each tick, the
 * topmost queued public proposal becomes a referendum. The Democracy
 * screen shows where the current cycle stands and how long until the
 * next launch — analogous to the web wallet's "launch period" pie.
 *
 * Extracted from DemocracyOverview so it's independently testable.
 */

import { blocksToHuman } from '@/governance';

export interface LaunchProgress {
  /** Current launch cycle index (0-based). */
  cycle: number;
  /** Where we are inside the cycle, in blocks. */
  positionInCycle: number;
  /** Block at which the next launch tick fires. */
  nextLaunchBlock: number;
  /** Human-readable label for the row's main line. */
  remainingLabel: string;
  /** 0–100 percent progress through the current cycle. */
  progressPct: number;
}

/**
 * Compute the current launch-cycle position.
 *
 * Edge cases:
 *   - launchPeriod = 0 returns a zero-progress placeholder (the
 *     screen would never call this in practice but defensive).
 *   - currentBlock = N * launchPeriod (exactly on a tick) returns
 *     position = 0, progressPct = 0, cycle = N. The next tick is
 *     one full launchPeriod away.
 */
export function launchProgress(
  currentBlock: number,
  launchPeriod: number
): LaunchProgress {
  if (launchPeriod <= 0) {
    return {
      cycle: 0,
      positionInCycle: 0,
      nextLaunchBlock: currentBlock,
      remainingLabel: '—',
      progressPct: 0,
    };
  }
  const cycle = Math.floor(currentBlock / launchPeriod);
  const positionInCycle = currentBlock % launchPeriod;
  const nextLaunchBlock = (cycle + 1) * launchPeriod;
  const delta = blocksToHuman(currentBlock, nextLaunchBlock);
  const progressPct = Math.min(
    100,
    Math.max(0, (positionInCycle / launchPeriod) * 100)
  );
  return {
    cycle,
    positionInCycle,
    nextLaunchBlock,
    remainingLabel: `${delta.label} until next launch`,
    progressPct,
  };
}
