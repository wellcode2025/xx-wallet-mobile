import clsx from 'clsx';
import { type BountyStatus, statusLabel } from '@/hooks';

/**
 * BountyStatusBadge — small colored pill rendering the bounty's status.
 *
 * Colors map to the wallet's existing semantic palette:
 *   - active           → xx-500 (primary; "currently in motion")
 *   - pendingPayout    → xx-500 (also primary; payout imminent)
 *   - curatorProposed  → warning (amber; action pending from curator)
 *   - funded           → warning (amber; awaiting curator nomination)
 *   - proposed         → ink-300 (neutral; council must approve)
 *   - unknown          → danger (red; surface the surprise)
 *
 * We never collapse an unknown variant into a friendly fallback — the
 * badge says "Status: unknown" loudly so users notice if the runtime
 * adds a new variant.
 */
export function BountyStatusBadge({ status }: { status: BountyStatus }) {
  const cls = badgeColors(status.kind);
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium font-sans',
        'border whitespace-nowrap',
        cls
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

function badgeColors(kind: BountyStatus['kind']): string {
  switch (kind) {
    case 'active':
    case 'pendingPayout':
      return 'bg-xx-500/10 text-xx-500 border-xx-500/30';
    case 'curatorProposed':
    case 'funded':
      return 'bg-ink-800 text-warning border-ink-700/50';
    case 'proposed':
      return 'bg-ink-800 text-ink-300 border-ink-700/50';
    case 'unknown':
      return 'bg-ink-800 text-danger border-ink-700/50';
  }
}
