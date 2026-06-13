import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ExternalLink, Plus } from 'lucide-react';
import { TopBar } from '@/components/layout';
import { LoadingIndicator } from '@/components/ui';
import { useBounties } from '@/hooks';
import { formatBalance } from '@/utils';
import { BountyRow } from './BountyRow';
import { ProposeBountySheet } from './ProposeBountySheet';

/**
 * Bounties list screen.
 *
 * `/governance/bounties` lands here. Three tabs to match the official xx
 * web wallet:
 *
 *   Active   — bounties currently in any open status (Proposed / Funded /
 *              CuratorProposed / Active / PendingPayout). Rendered as a
 *              row list with per-row curator + updateDue + value.
 *   Past     — closed bounties. The chain prunes their on-chain state
 *              after claim, so the count is recoverable (totalCount minus
 *              active.length) but per-id details aren't. Renders a stub
 *              that links out to the explorer's bounty history.
 *   Children — child bounties across all parents. Currently 0 on xx;
 *              empty-state-tolerant.
 *
 * Read-only — no actions on this screen. Viewing only; curator
 * workflow extrinsics are out of scope for this wallet.
 */

type Tab = 'active' | 'past' | 'children';

const EXPLORER_BOUNTIES_URL = 'https://explorer.xx.network/bounties';

export function BountiesList() {
  const { bounties, totalCount, pastCount, childCount, isLoading, error } =
    useBounties();
  const [tab, setTab] = useState<Tab>('active');
  const [proposeOpen, setProposeOpen] = useState(false);

  const activeValueTotal = useMemo(
    () => bounties.reduce((acc, b) => acc + BigInt(b.value.toString()), 0n),
    [bounties]
  );

  return (
    <>
      <TopBar title="Bounties" showBack />
      <div className="px-5 py-4 space-y-4 max-w-md mx-auto pb-8">
        {/* Summary line: active count + value, helps anchor before tabs */}
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-ink-300">
            <span className="text-ink-100 font-medium">
              {isLoading ? '…' : bounties.length}
            </span>{' '}
            active
            {!isLoading && bounties.length > 0 && (
              <>
                {' '}·{' '}
                <span className="font-mono text-ink-100">
                  {formatBalance(activeValueTotal.toString(), {
                    decimals: 0,
                    trim: true,
                    grouping: true,
                  })}
                </span>{' '}
                XX
              </>
            )}
          </p>
          {!isLoading && totalCount > 0 && (
            <p className="text-xs text-ink-300 shrink-0">
              {totalCount} all-time
            </p>
          )}
        </div>

        {/* Segmented tabs */}
        <div className="flex gap-1 p-1 rounded-2xl bg-ink-900 border border-ink-800">
          <TabButton
            label={`Active${bounties.length ? ` · ${bounties.length}` : ''}`}
            active={tab === 'active'}
            onClick={() => setTab('active')}
          />
          <TabButton
            label={`Past${pastCount ? ` · ${pastCount}` : ''}`}
            active={tab === 'past'}
            onClick={() => setTab('past')}
          />
          <TabButton
            label={`Children${childCount ? ` · ${childCount}` : ''}`}
            active={tab === 'children'}
            onClick={() => setTab('children')}
          />
        </div>

        {tab === 'active' && (
          <button
            onClick={() => setProposeOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-sm text-xx-500 font-medium active:bg-ink-800 transition-colors"
          >
            <Plus size={14} strokeWidth={2} />
            Propose bounty
          </button>
        )}

        {/* Loading + error states share across tabs (data is one fetch) */}
        {isLoading && (
          <>
            <LoadingIndicator message="Loading bounties from chain..." />
            <BountiesListSkeleton />
          </>
        )}
        {error && !isLoading && (
          <div className="card">
            <p className="text-sm text-danger">
              Couldn't load bounties — check your connection and try again.
            </p>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {tab === 'active' && (
              bounties.length === 0 ? (
                <EmptyState
                  title="No active bounties"
                  body="There are no open bounties on chain right now."
                />
              ) : (
                <div className="card">
                  <ul>
                    {bounties.map((b) => (
                      <BountyRow key={b.id} bounty={b} />
                    ))}
                  </ul>
                </div>
              )
            )}

            {tab === 'past' && (
              <PastBountiesStub count={pastCount} />
            )}

            {tab === 'children' && (
              <EmptyState
                title={
                  childCount === 0
                    ? 'No child bounties'
                    : `${childCount} child bounties`
                }
                body={
                  childCount === 0
                    ? 'Child bounties are nested grants from a parent bounty. None are open on xx right now.'
                    : 'Open the parent bounty to see its child bounties.'
                }
              />
            )}
          </>
        )}
      </div>

      <ProposeBountySheet
        open={proposeOpen}
        onClose={() => setProposeOpen(false)}
      />
    </>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex-1 text-center text-sm font-medium py-2 rounded-xl transition-colors',
        active
          ? 'bg-ink-800 text-xx-500'
          : 'text-ink-300 active:bg-ink-800/50'
      )}
    >
      {label}
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="card">
      <p className="text-sm text-ink-100 font-medium">{title}</p>
      <p className="mt-1 text-sm text-ink-300">{body}</p>
    </div>
  );
}

function PastBountiesStub({ count }: { count: number }) {
  return (
    <div className="card space-y-3">
      <div>
        <p className="text-sm text-ink-100 font-medium">
          {count} past {count === 1 ? 'bounty' : 'bounties'}
        </p>
        <p className="mt-1 text-sm text-ink-300">
          Once a bounty is awarded and claimed, the chain prunes its
          details. To browse the history with proposers, curators, and
          payout amounts, open the explorer.
        </p>
      </div>
      <a
        href={EXPLORER_BOUNTIES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-xx-500 active:text-xx-400 transition-colors"
      >
        Open bounty history on explorer.xx.network
        <ExternalLink size={14} strokeWidth={1.75} />
      </a>
    </div>
  );
}

function BountiesListSkeleton() {
  return (
    <div className="card space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-ink-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3 rounded bg-ink-800 w-3/4" />
            <div className="h-3 rounded bg-ink-800 w-1/2" />
          </div>
          <div className="w-16 h-4 rounded bg-ink-800" />
        </div>
      ))}
    </div>
  );
}
