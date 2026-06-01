/**
 * updateDueBadge — pure mapping from a block-delta to a badge style.
 *
 * Bounty rows show an "update due" indicator next to the value. The
 * color thresholds:
 *
 *   - red  "Update overdue"  when isOverdue (target block ≤ current)
 *   - amber                  when 0 < remaining < 7 days
 *   - green                  when remaining ≥ 7 days
 *
 * Returned `label` is the human countdown string from governanceTimer
 * for green/amber, and the literal "Update overdue" for red (per the
 * web wallet's wording). `kind` exists so the badge UI can branch on
 * tone without re-deriving from the timer.
 */

import { blocksToHuman } from '@/governance';

export type UpdateDueKind = 'green' | 'amber' | 'red' | 'none';

export interface UpdateDueBadge {
  kind: UpdateDueKind;
  label: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function updateDueBadge(
  currentBlock: number | null | undefined,
  targetBlock: number | null | undefined
): UpdateDueBadge {
  if (currentBlock == null || targetBlock == null) {
    return { kind: 'none', label: '—' };
  }
  const delta = blocksToHuman(currentBlock, targetBlock);
  if (delta.isOverdue) {
    return { kind: 'red', label: 'Update overdue' };
  }
  if (delta.remainingMs < SEVEN_DAYS_MS) {
    return { kind: 'amber', label: delta.label };
  }
  return { kind: 'green', label: delta.label };
}
