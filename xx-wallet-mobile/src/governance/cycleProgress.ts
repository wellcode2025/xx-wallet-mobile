/**
 * cycleProgress — pure math for repeated-period progress bars.
 *
 * Substrate has several pallets that tick events on a fixed-period
 * cadence:
 *   - democracy.launchPeriod → next public referendum launch
 *   - elections.termDuration → next council election
 *   - treasury.spendPeriod   → next treasury spend / burn
 *   - bounties.bountyUpdatePeriod → bounty curator update window
 *
 * They all follow the same pattern: the next event fires at the next
 * multiple of `period` past the current block. cycleProgress computes
 * where we are inside the current cycle plus a human countdown
 * suitable for a progress bar's "X until next NOUN" label.
 *
 * Generalised from the per-screen launchProgress helper that originally
 * shipped with the Democracy screen. The Council screen reuses it for
 * term-progress with `noun: 'election'`.
 */

import { blocksToHuman } from './timer';

export interface CycleProgress {
  /** Current cycle index (0-based). */
  cycle: number;
  /** Where we are inside the cycle, in blocks. */
  positionInCycle: number;
  /** Block at which the next cycle event fires. */
  nextEventBlock: number;
  /** Human label e.g. "5 days 3 hrs until next launch". */
  remainingLabel: string;
  /** 0–100 percent progress through the current cycle. */
  progressPct: number;
}

/**
 * Compute the current cycle position.
 *
 * `noun` is the lowercase singular for the countdown label
 * ("launch" → "5 days 3 hrs until next launch", "election" → "…
 * until next election"). Keep it short — it's appended to a
 * blocksToHuman label that may already be wide on smaller screens.
 *
 * Edge cases:
 *   - period = 0 returns a zero-progress placeholder.
 *   - currentBlock = N * period (exactly on a tick) returns
 *     position = 0, progressPct = 0, cycle = N. The next tick is
 *     one full period away.
 */
export function cycleProgress(
  currentBlock: number,
  period: number,
  noun: string
): CycleProgress {
  if (period <= 0) {
    return {
      cycle: 0,
      positionInCycle: 0,
      nextEventBlock: currentBlock,
      remainingLabel: '—',
      progressPct: 0,
    };
  }
  const cycle = Math.floor(currentBlock / period);
  const positionInCycle = currentBlock % period;
  const nextEventBlock = (cycle + 1) * period;
  const delta = blocksToHuman(currentBlock, nextEventBlock);
  const progressPct = Math.min(
    100,
    Math.max(0, (positionInCycle / period) * 100)
  );
  return {
    cycle,
    positionInCycle,
    nextEventBlock,
    remainingLabel: `${delta.label} until next ${noun}`,
    progressPct,
  };
}
