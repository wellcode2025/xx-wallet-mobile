import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ExternalLink,
  Globe,
} from 'lucide-react';
import { TopBar } from '@/components/layout';
import { AddressIcon, LoadingIndicator } from '@/components/ui';
import { useBountyDetail, curatorAddressOf, type BountyStatus } from '@/hooks';
import { useConnectionStore } from '@/store';
import { formatBalance } from '@/utils';
import {
  displayName,
  useIdentity,
  blocksToHuman,
} from '@/governance';
import { BountyStatusBadge } from './BountyStatusBadge';

/**
 * Bounty detail screen.
 *
 * `/governance/bounties/:id`. Shows everything a user can learn about a
 * bounty from chain state alone:
 *
 *   - Title (parsed from the forum-link description) + bounty id
 *   - Status badge + Active-state update-due countdown
 *   - Description: canonical forum link (tap-through) or external host
 *     warning, plus the raw text if it's more than just an anchor
 *   - Money fields: value, curator fee, curator deposit, proposer bond
 *   - Proposer + curator identity rows (AddressIcon + IdentityResolver)
 *   - Child bounties section (currently 0 on xx but future-proofed)
 *
 * Read-only. Curator workflow extrinsics (acceptCurator, awardBounty,
 * etc.) are foundation-only and out of scope for this wallet.
 */

export function BountyDetail() {
  const params = useParams<{ id: string }>();
  const id = parseId(params.id);
  const { bounty, isLoading, error } = useBountyDetail(id);

  return (
    <>
      <TopBar
        title={id != null ? `Bounty #${id}` : 'Bounty'}
        showBack
      />
      <div className="px-5 py-4 space-y-4 max-w-md mx-auto pb-8">
        {id == null && (
          <div className="card">
            <p className="text-sm text-danger">
              That bounty id isn't valid.
            </p>
          </div>
        )}

        {id != null && isLoading && (
          <>
            <LoadingIndicator message="Loading bounty from chain..." />
            <BountyDetailSkeleton />
          </>
        )}

        {id != null && error && !isLoading && (
          <div className="card">
            <p className="text-sm text-danger">
              {error.message ||
                "Couldn't load the bounty — check your connection and try again."}
            </p>
          </div>
        )}

        {id != null && !isLoading && !error && bounty && (
          <>
            <HeaderCard
              title={
                bounty.descriptionLink.title.trim().length > 0
                  ? bounty.descriptionLink.title
                  : `Bounty #${bounty.id}`
              }
              id={bounty.id}
              status={bounty.status}
              value={bounty.value}
            />

            <DescriptionCard
              isCanonical={bounty.descriptionLink.isCanonicalForumLink}
              href={bounty.descriptionLink.href}
              host={bounty.descriptionLink.host}
              raw={bounty.description}
            />

            <StatusDetailCard status={bounty.status} />

            <MoneyCard
              value={bounty.value}
              fee={bounty.fee}
              curatorDeposit={bounty.curatorDeposit}
              bond={bounty.bond}
            />

            <PeopleCard
              proposer={bounty.proposer}
              curator={curatorAddressOf(bounty.status)}
            />

            <ChildBountiesCard children_={bounty.childBounties} />
          </>
        )}
      </div>
    </>
  );
}

// --------------------------------------------------------------------------
// Subcomponents
// --------------------------------------------------------------------------

function HeaderCard({
  title,
  id,
  status,
  value,
}: {
  title: string;
  id: number;
  status: BountyStatus;
  value: import('@polkadot/util').BN;
}) {
  return (
    <div className="card">
      <p className="text-xs text-ink-300 font-mono">#{id}</p>
      <h1 className="mt-1 font-display text-xl text-ink-100 leading-snug">
        {title}
      </h1>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <BountyStatusBadge status={status} />
        <div className="text-right">
          <p className="font-mono text-2xl text-ink-100 numeric">
            {formatBalance(value, {
              decimals: 4,
              trim: true,
              grouping: true,
            })}
          </p>
          <p className="text-xs text-ink-300">XX</p>
        </div>
      </div>
    </div>
  );
}

function DescriptionCard({
  isCanonical,
  href,
  host,
  raw,
}: {
  isCanonical: boolean;
  href: string | null;
  host: string | null;
  raw: string;
}) {
  // No anchor — fall back to showing the plain text if any.
  if (!href) {
    return (
      <div className="card">
        <p className="text-xs text-ink-300 mb-1">Description</p>
        {raw.trim().length > 0 ? (
          <p className="text-sm text-ink-200 break-words">{raw}</p>
        ) : (
          <p className="text-sm text-ink-300 italic">No description on chain.</p>
        )}
      </div>
    );
  }
  if (isCanonical) {
    return (
      <div className="card">
        <p className="text-xs text-ink-300 mb-2">Description</p>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-xx-500 active:text-xx-400 transition-colors"
        >
          <Globe size={14} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">{host}</span>
          <ExternalLink size={14} strokeWidth={1.75} className="shrink-0" />
        </a>
        <p className="mt-2 text-xs text-ink-300">
          Tap to read the proposer's full description on the xx forum.
        </p>
      </div>
    );
  }
  // External — render with a visible warning per the trust-decisions-visible
  // rule. The user can still tap through, but we surface the host loudly.
  return (
    <div className="card border-warning/40 bg-warning/5">
      <p className="text-xs text-warning mb-2 flex items-center gap-1.5">
        <AlertTriangle size={12} strokeWidth={2} />
        Description links outside forum.xx.network
      </p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-sm text-ink-100 active:text-warning transition-colors"
      >
        <Globe size={14} strokeWidth={1.75} className="shrink-0" />
        <span className="truncate">{host ?? href}</span>
        <ExternalLink size={14} strokeWidth={1.75} className="shrink-0" />
      </a>
      <p className="mt-2 text-xs text-ink-300">
        The proposer chose both the link text and where it points. Verify
        the host before tapping through.
      </p>
    </div>
  );
}

function StatusDetailCard({ status }: { status: BountyStatus }) {
  const blockNumber = useConnectionStore((s) => s.blockNumber);

  if (status.kind === 'active') {
    const delta = blocksToHuman(blockNumber, status.updateDue);
    return (
      <div className="card">
        <p className="text-xs text-ink-300 mb-1">Update due</p>
        {delta.isOverdue ? (
          <p className="text-sm text-danger font-medium">
            Update overdue ({delta.label})
          </p>
        ) : (
          <p className="text-sm text-ink-100">
            <span className="font-medium">{delta.label}</span>
            <span className="text-ink-300"> remaining</span>
          </p>
        )}
        <p className="mt-1 text-xs text-ink-300">
          The curator must post a status update on the forum before block{' '}
          <span className="font-mono">#{status.updateDue.toLocaleString()}</span>.
        </p>
      </div>
    );
  }

  if (status.kind === 'pendingPayout') {
    const delta = blocksToHuman(blockNumber, status.unlockAt);
    return (
      <div className="card">
        <p className="text-xs text-ink-300 mb-1">Payout unlock</p>
        <p className="text-sm text-ink-100">
          <span className="font-medium">{delta.label}</span>
          <span className="text-ink-300">
            {' '}
            {delta.isOverdue ? 'past' : 'remaining'}
          </span>
        </p>
        <p className="mt-1 text-xs text-ink-300">
          Beneficiary can claim after block{' '}
          <span className="font-mono">#{status.unlockAt.toLocaleString()}</span>.
        </p>
      </div>
    );
  }

  if (status.kind === 'unknown') {
    return (
      <div className="card border-danger/40 bg-danger/5">
        <p className="text-xs text-danger mb-1 flex items-center gap-1.5">
          <AlertTriangle size={12} strokeWidth={2} />
          Unrecognised bounty status
        </p>
        <p className="text-sm text-ink-200 break-words font-mono">
          {JSON.stringify(status.raw)}
        </p>
        <p className="mt-2 text-xs text-ink-300">
          The chain returned a status variant this wallet doesn't yet
          recognise. The bounty is still visible above; tap-through actions
          on this bounty may not behave as expected.
        </p>
      </div>
    );
  }

  // Proposed / Funded / CuratorProposed — no special countdown.
  return null;
}

function MoneyCard({
  value,
  fee,
  curatorDeposit,
  bond,
}: {
  value: import('@polkadot/util').BN;
  fee: import('@polkadot/util').BN;
  curatorDeposit: import('@polkadot/util').BN;
  bond: import('@polkadot/util').BN;
}) {
  return (
    <div className="card space-y-2">
      <p className="text-xs text-ink-300">Funding</p>
      <MoneyRow label="Bounty value" amount={value} />
      <MoneyRow
        label="Curator fee"
        amount={fee}
        hint="Paid to the curator from the bounty value on completion."
      />
      <MoneyRow
        label="Curator deposit"
        amount={curatorDeposit}
        hint="Locked while the curator is active; returned on completion."
      />
      <MoneyRow
        label="Proposer bond"
        amount={bond}
        hint="Refunded when the bounty closes."
      />
    </div>
  );
}

function MoneyRow({
  label,
  amount,
  hint,
}: {
  label: string;
  amount: import('@polkadot/util').BN;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-200">{label}</p>
        {hint && <p className="text-xs text-ink-300 mt-0.5">{hint}</p>}
      </div>
      <p className="font-mono text-sm text-ink-100 numeric whitespace-nowrap shrink-0">
        {formatBalance(amount, {
          decimals: 4,
          trim: true,
          grouping: true,
        })}{' '}
        <span className="text-ink-300">XX</span>
      </p>
    </div>
  );
}

function PeopleCard({
  proposer,
  curator,
}: {
  proposer: string;
  curator: string | null;
}) {
  return (
    <div className="card space-y-3">
      <p className="text-xs text-ink-300">People</p>
      <PersonRow role="Proposer" address={proposer} />
      {curator && <PersonRow role="Curator" address={curator} />}
    </div>
  );
}

function PersonRow({ role, address }: { role: string; address: string }) {
  const { identity } = useIdentity(address);
  const name = displayName(identity, address);
  return (
    <div className="flex items-center gap-3">
      <AddressIcon address={address} size={32} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-300">{role}</p>
        <p className="text-sm text-ink-100 truncate">{name.primary}</p>
        {name.secondary && (
          <p className="text-xs text-ink-300 font-mono truncate">
            {name.secondary}
          </p>
        )}
      </div>
    </div>
  );
}

function ChildBountiesCard({
  children_,
}: {
  children_: import('@/hooks').ChildBountySummary[];
}) {
  if (children_.length === 0) {
    return (
      <div className="card">
        <p className="text-xs text-ink-300 mb-1">Child bounties</p>
        <p className="text-sm text-ink-300 italic">
          No child bounties under this bounty.
        </p>
      </div>
    );
  }
  return (
    <div className="card space-y-2">
      <p className="text-xs text-ink-300">Child bounties · {children_.length}</p>
      <ul className="divide-y divide-ink-800/60">
        {children_.map((c) => (
          <li key={c.childId} className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm text-ink-100 truncate">
                <span className="font-mono text-ink-300">#{c.childId}</span>{' '}
                {c.descriptionLink.title.trim().length > 0
                  ? c.descriptionLink.title
                  : `Child #${c.childId}`}
              </p>
              <p className="font-mono text-sm text-ink-100 numeric whitespace-nowrap shrink-0">
                {formatBalance(c.value, {
                  decimals: 4,
                  trim: true,
                  grouping: true,
                })}{' '}
                <span className="text-ink-300">XX</span>
              </p>
            </div>
            <div className="mt-1">
              <BountyStatusBadge status={c.status} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BountyDetailSkeleton() {
  return (
    <div className="space-y-3">
      <div className="card animate-pulse space-y-3">
        <div className="h-3 rounded bg-ink-800 w-1/6" />
        <div className="h-5 rounded bg-ink-800 w-5/6" />
        <div className="flex justify-between">
          <div className="h-5 w-20 rounded-full bg-ink-800" />
          <div className="h-7 w-24 rounded bg-ink-800" />
        </div>
      </div>
      <div className="card animate-pulse space-y-2">
        <div className="h-3 rounded bg-ink-800 w-1/4" />
        <div className="h-4 rounded bg-ink-800 w-2/3" />
      </div>
    </div>
  );
}

function parseId(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}
