import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Banknote, ExternalLink } from 'lucide-react';
import { formatBalance } from '@/utils';
import { useConnectionStore } from '@/store';
import {
  curatorAddressOf,
  type BountySummary,
} from '@/hooks';
import { displayName, useIdentity } from '@/governance';
import { updateDueBadge, type UpdateDueKind } from './updateDueBadge';
import { BountyStatusBadge } from './BountyStatusBadge';

/**
 * BountyRow — one row in the active-bounties list.
 *
 * Renders:
 *   - the parsed forum-link title (proposer-supplied; not decoded truth)
 *   - the bounty id alongside the title (always-visible source-of-truth)
 *   - the bounty value, formatted XX with thousand separators
 *   - the curator name (via IdentityResolver) and the status badge
 *   - the live update-due countdown when the status is Active
 *
 * Taps through to /governance/bounties/:id.
 */
export function BountyRow({ bounty }: { bounty: BountySummary }) {
  const curatorAddress = curatorAddressOf(bounty.status);
  const { identity } = useIdentity(curatorAddress);
  const curatorName = curatorAddress
    ? displayName(identity, curatorAddress)
    : null;

  const blockNumber = useConnectionStore((s) => s.blockNumber);
  const updateDue =
    bounty.status.kind === 'active'
      ? updateDueBadge(blockNumber, bounty.status.updateDue)
      : null;

  // Prefer the parsed title; fall back to "Bounty #N" when no description.
  const title =
    bounty.descriptionLink.title.trim().length > 0
      ? bounty.descriptionLink.title
      : `Bounty #${bounty.id}`;

  return (
    <li className="border-b border-ink-800/60 last:border-0">
      <Link
        to={`/governance/bounties/${bounty.id}`}
        className="flex items-start gap-3 py-3 -mx-3 px-3 rounded-xl active:bg-ink-800/40 transition-colors"
      >
        <div className="shrink-0 w-9 h-9 rounded-xl bg-ink-800 text-ink-300 flex items-center justify-center">
          <Banknote size={18} strokeWidth={1.75} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-xs text-ink-300 shrink-0">
              #{bounty.id}
            </span>
            <span className="text-sm text-ink-100 truncate">{title}</span>
            {bounty.descriptionLink.isCanonicalForumLink && (
              <ExternalLink
                size={12}
                strokeWidth={1.75}
                className="shrink-0 text-ink-400"
                aria-label="Has forum link"
              />
            )}
          </div>

          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <BountyStatusBadge status={bounty.status} />
            {updateDue && updateDue.kind !== 'none' && (
              <UpdateDueChip kind={updateDue.kind} label={updateDue.label} />
            )}
            {curatorName && (
              <span className="text-xs text-ink-300 truncate min-w-0">
                Curator: <span className="text-ink-300">{curatorName.primary}</span>
              </span>
            )}
          </div>
        </div>

        <div className="text-right shrink-0 pl-1">
          <p className="font-mono text-sm text-ink-100 numeric whitespace-nowrap">
            {formatBalance(bounty.value, {
              decimals: 4,
              trim: true,
              grouping: true,
            })}
          </p>
          <p className="text-xs text-ink-300">XX</p>
        </div>
      </Link>
    </li>
  );
}

function UpdateDueChip({
  kind,
  label,
}: {
  kind: UpdateDueKind;
  label: string;
}) {
  const colorCls =
    kind === 'red'
      ? 'bg-ink-800 text-danger border-ink-700/50'
      : kind === 'amber'
      ? 'bg-ink-800 text-warning border-ink-700/50'
      : 'bg-ink-800 text-ink-300 border-ink-700/50';
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium font-sans whitespace-nowrap border',
        colorCls
      )}
    >
      {kind === 'red' ? label : `Update in ${label}`}
    </span>
  );
}
