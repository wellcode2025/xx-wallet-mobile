/**
 * useStaleness — compute pending-proposal age + stale flag.
 *
 * Combines the user's stale-threshold setting (Settings → Multisig)
 * with the current chain head (subscribed via useConnectionStore) to
 * produce a function consumers can call with any proposal's `whenBlock`
 * to get back its age and a boolean for whether it crosses the
 * "stale" line.
 *
 * Why a hook returning a function rather than a per-proposal hook:
 * pending lists can have several entries; we want to compute staleness
 * for all of them on the same render with one block-number / threshold
 * snapshot, not subscribe N times.
 *
 * Per design doc §6.7. Defaults match xx network's ~6-second block time.
 */

import { useMemo } from 'react';
import { useConnectionStore, useSettingsStore } from '@/store';
import { XX_BLOCK_TIME_MS } from '@/api';

export interface StalenessInfo {
  /** How many blocks since this proposal was submitted. 0 if we don't
   *  yet know the current block (chain not connected yet). */
  ageBlocks: number;
  /** Same age in days (fractional). Useful for "23 days old" copy. */
  ageDays: number;
  /** True if age exceeds the user's configured threshold. */
  isStale: boolean;
}

const ZERO: StalenessInfo = { ageBlocks: 0, ageDays: 0, isStale: false };

export function useStaleness(): (whenBlock: number) => StalenessInfo {
  const currentBlock = useConnectionStore((s) => s.blockNumber);
  const thresholdDays = useSettingsStore((s) => s.staleThresholdDays);

  return useMemo(() => {
    // 6-second blocks → 14400 blocks/day. We use the chain constant
    // rather than hard-coding 6 so a future block-time change in the
    // runtime constants automatically flows through.
    const blocksPerDay = (24 * 60 * 60 * 1000) / XX_BLOCK_TIME_MS;
    const thresholdBlocks = thresholdDays * blocksPerDay;

    return (whenBlock: number): StalenessInfo => {
      if (!currentBlock || currentBlock <= whenBlock) return ZERO;
      const ageBlocks = currentBlock - whenBlock;
      const ageDays = ageBlocks / blocksPerDay;
      return {
        ageBlocks,
        ageDays,
        isStale: ageBlocks > thresholdBlocks,
      };
    };
  }, [currentBlock, thresholdDays]);
}

/**
 * Format a stale age for compact display. Picks the unit that reads
 * cleanest at the given magnitude.
 *
 *   formatAge(0.4)   → "today"
 *   formatAge(1.6)   → "2 days"
 *   formatAge(45)    → "45 days"
 *   formatAge(120)   → "4 months"
 *   formatAge(400)   → "1 year"
 */
export function formatAge(ageDays: number): string {
  if (ageDays < 1) return 'today';
  const days = Math.round(ageDays);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(ageDays / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.round(ageDays / 365);
  return `${years} year${years === 1 ? '' : 's'}`;
}
