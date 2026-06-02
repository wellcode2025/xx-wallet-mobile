/**
 * useAutoSelection — the auto-nominate picks after the user's optional
 * quality levers are applied.
 *
 * The base picks come from useAutoNominate (cached chain read + Phragmén).
 * The levers (from settings) re-rank that already-computed candidate set
 * client-side, so toggling them is instant with no re-fetch. With levers
 * off this returns exactly the base selection.
 *
 * Used both for display (AutoNominateBlock) and for the submitted targets
 * (Start staking / Change validators), so the two never drift apart.
 */

import { useMemo } from 'react';
import { useSettingsStore } from '@/store';
import {
  applyQualityLevers,
  countSelectionChanges,
  leversActiveCount,
  type AutoNominateResult,
  type AutoNominateValidator,
  type QualityLevers,
} from '@/staking';

export interface AutoSelection {
  /** Validators to nominate, after the user's levers. */
  selected: AutoNominateValidator[];
  /** Base (no-lever) top picks, for "N changed" comparison. */
  defaultSelected: AutoNominateValidator[];
  /** How many picks differ from the base selection. */
  changedCount: number;
  levers: QualityLevers;
  /** Number of active (non-default) levers. */
  leverCount: number;
}

export function useAutoSelection(
  result: AutoNominateResult | null
): AutoSelection {
  const levers = useSettingsStore((s) => s.autoNominateLevers);
  const defaultSelected = useMemo(() => result?.selected ?? [], [result]);
  const selected = useMemo(
    () => (result ? applyQualityLevers(result.allElected, levers) : []),
    [result, levers]
  );
  const changedCount = useMemo(
    () => countSelectionChanges(selected, defaultSelected),
    [selected, defaultSelected]
  );
  return {
    selected,
    defaultSelected,
    changedCount,
    levers,
    leverCount: leversActiveCount(levers),
  };
}
