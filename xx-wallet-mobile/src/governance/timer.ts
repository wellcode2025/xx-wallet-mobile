/**
 * governanceTimer — convert block deltas into human-readable durations.
 *
 * Used by every governance surface that has a deadline encoded as a target
 * block number:
 *   - Bounty `updateDue` ("29 days 3 hrs" or "Update overdue")
 *   - Democracy launch / voting / enactment / cooloff periods
 *   - Council term progress
 *   - Treasury spendPeriod countdown
 *
 * Pure function — no chain calls, no React. Caller supplies the current
 * block (from `useBlockNumber` or similar) and a target block; we return
 * the structured delta plus a default human-readable label.
 *
 * The label format matches the official xx web wallet's "29 days 3 hrs"
 * shape. Bounty UI overrides the default label to "Update overdue" when
 * `isOverdue` is true; other consumers can format their own copy off the
 * structured fields.
 */

import { XX_BLOCK_TIME_MS } from '@/api/constants';

export interface BlockDelta {
  /** Signed remaining blocks. Positive = target is in the future. */
  remainingBlocks: number;
  /** Signed remaining milliseconds at the chain's target block time. */
  remainingMs: number;
  /** Absolute-value days portion. */
  days: number;
  /** Absolute-value hours portion (0–23). */
  hours: number;
  /** Absolute-value minutes portion (0–59). */
  minutes: number;
  /**
   * Default human label. Examples:
   *   - "29 days 3 hrs"      (future, ≥ 1 day)
   *   - "5 hrs 30 min"       (future, < 1 day, ≥ 1 hour)
   *   - "12 min"             (future, < 1 hour, ≥ 1 minute)
   *   - "<1 min"             (future, < 1 minute)
   *   - "now"                (exactly zero)
   *   - "Past 12 days 3 hrs" (overdue)
   *
   * Bounty UI explicitly overrides this to "Update overdue" when the
   * timer is past-due — that's surface-specific copy, not the timer's
   * concern. Other consumers can format off the d/h/m fields directly.
   */
  label: string;
  /** True iff target block is at or before current block. */
  isOverdue: boolean;
}

/**
 * Compute the duration from `currentBlock` to `targetBlock`.
 *
 * `currentBlock` should be the chain head at the moment of computation;
 * components that re-render on block tick will get a live countdown for
 * free. Pass `null`/`undefined` block values to get a zero-duration
 * placeholder result.
 */
export function blocksToHuman(
  currentBlock: number | null | undefined,
  targetBlock: number | null | undefined
): BlockDelta {
  if (
    currentBlock == null ||
    targetBlock == null ||
    !Number.isFinite(currentBlock) ||
    !Number.isFinite(targetBlock)
  ) {
    return {
      remainingBlocks: 0,
      remainingMs: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      label: '—',
      isOverdue: false,
    };
  }
  const remainingBlocks = targetBlock - currentBlock;
  const remainingMs = remainingBlocks * XX_BLOCK_TIME_MS;
  const isOverdue = remainingBlocks <= 0;

  const absMs = Math.abs(remainingMs);
  const totalMin = Math.floor(absMs / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const minutes = totalMin % 60;

  let label: string;
  if (remainingBlocks === 0) {
    label = 'now';
  } else if (!isOverdue) {
    label = formatFuture(days, hours, minutes);
  } else {
    label = `Past ${formatFuture(days, hours, minutes)}`;
  }

  return { remainingBlocks, remainingMs, days, hours, minutes, label, isOverdue };
}

function formatFuture(d: number, h: number, m: number): string {
  if (d >= 1) {
    // "29 days 3 hrs" — drop hours when 0 to keep it clean ("29 days").
    return h > 0 ? `${d} day${d === 1 ? '' : 's'} ${h} hr${h === 1 ? '' : 's'}` : `${d} day${d === 1 ? '' : 's'}`;
  }
  if (h >= 1) {
    return m > 0 ? `${h} hr${h === 1 ? '' : 's'} ${m} min` : `${h} hr${h === 1 ? '' : 's'}`;
  }
  if (m >= 1) {
    return `${m} min`;
  }
  return '<1 min';
}
