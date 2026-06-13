/**
 * StakingStatusBadge — the three-state nomination status pill.
 *
 * Maps a NominationStatus (derived from chain data — see
 * useStakingPosition) to a coloured dot + label. The badge keeps two
 * facts distinct that are easy to conflate: "you nominate this
 * validator" and "this nomination is earning you anything". Same
 * decoded-from-source honesty the multisig surface uses — we render
 * the real status, never a softened one.
 */

import clsx from 'clsx';
import type { NominationStatus } from '@/hooks/useStakingPosition';

const STATUS_CONFIG: Record<
  NominationStatus,
  { label: string; dot: string; text: string; help: string }
> = {
  active: {
    label: 'Active',
    dot: 'bg-success',
    text: 'text-success',
    help: 'Earning rewards from this validator this era.',
  },
  'not-earning': {
    label: 'Not earning',
    dot: 'bg-warning',
    text: 'text-warning',
    help:
      "You nominate this validator, but it isn't earning you anything this " +
      "era — either its rewarded set is full, or the election assigned your " +
      'stake to your other nominations.',
  },
  inactive: {
    label: 'Inactive',
    dot: 'bg-ink-600',
    text: 'text-ink-300',
    help: "This validator isn't in the elected set this era.",
  },
};

export function StakingStatusBadge({ status }: { status: NominationStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full flex-shrink-0',
        'bg-ink-800 border border-ink-700/50 text-xs font-medium',
        cfg.text
      )}
      title={cfg.help}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full', cfg.dot)} />
      {cfg.label}
    </span>
  );
}
