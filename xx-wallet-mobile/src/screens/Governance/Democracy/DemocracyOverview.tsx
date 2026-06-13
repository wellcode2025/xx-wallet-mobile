import { useState } from 'react';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import { LoadingIndicator } from '@/components/ui';
import { useDemocracy, usePreimages } from '@/hooks';
import { useConnectionStore } from '@/store';
import { cycleProgress } from '@/governance';
import { OverviewTab } from './OverviewTab';
import { PreimagesTab } from './PreimagesTab';

/**
 * Democracy + Preimages screen.
 *
 * `/governance/democracy`. Mirrors the official xx web wallet's
 * Democracy → Overview page: three live streams (referenda, public
 * proposals, external) plus a sibling Preimages tab.
 *
 * Empty-state-tolerant by design — in typical operation all three Overview
 * streams are zero. The decode-from-bytes invariant lives on the
 * Preimages tab; the orphaned 3,896-byte preimage at 0xa2652f… is the
 * production fixture for the "Unable to decode" UX.
 */

type Tab = 'overview' | 'preimages';

export function DemocracyOverview() {
  const democracy = useDemocracy();
  const preimages = usePreimages();
  const blockNumber = useConnectionStore((s) => s.blockNumber);
  const [tab, setTab] = useState<Tab>('overview');

  // Launch-period countdown — derived from the current block modulo the
  // launch period. The countdown ticks live off the connection store's
  // blockNumber subscription, so this re-renders every ~6 seconds.
  const launchInfo =
    blockNumber != null && democracy.periods.launchPeriod > 0
      ? cycleProgress(blockNumber, democracy.periods.launchPeriod, 'launch')
      : null;

  return (
    <>
      <TopBar title="Democracy" showBack />
      <div className="px-5 py-4 space-y-4 max-w-md mx-auto pb-8">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-ink-300">
            <span className="text-ink-100 font-medium">
              {democracy.isLoading ? '…' : democracy.ongoing.length}
            </span>{' '}
            active{' '}
            <span className="text-ink-100 font-medium">
              · {democracy.isLoading ? '…' : preimages.preimages.length}
            </span>{' '}
            preimages
          </p>
          {!democracy.isLoading && democracy.referendumCount > 0 && (
            <p className="text-xs text-ink-300 shrink-0">
              {democracy.referendumCount} referenda all-time
            </p>
          )}
        </div>

        {launchInfo && (
          <div className="rounded-2xl border border-ink-800 bg-ink-900/40 p-3">
            <p className="text-xs text-ink-300">Next launch window</p>
            <p className="mt-0.5 text-sm text-ink-100">
              <span className="font-medium">{launchInfo.remainingLabel}</span>
              <span className="text-ink-300"> · cycle {launchInfo.cycle}</span>
            </p>
            <div className="mt-2 h-1 rounded-full bg-ink-800 overflow-hidden">
              <div
                className="h-full bg-xx-500/60"
                style={{ width: `${launchInfo.progressPct}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-1 p-1 rounded-2xl bg-ink-900 border border-ink-800">
          <TabButton
            label={`Overview${
              democracy.ongoing.length ? ` · ${democracy.ongoing.length}` : ''
            }`}
            active={tab === 'overview'}
            onClick={() => setTab('overview')}
          />
          <TabButton
            label={`Preimages${
              preimages.preimages.length ? ` · ${preimages.preimages.length}` : ''
            }`}
            active={tab === 'preimages'}
            onClick={() => setTab('preimages')}
          />
        </div>

        {tab === 'overview' && (
          democracy.isLoading ? (
            <LoadingIndicator message="Loading democracy state..." />
          ) : democracy.error ? (
            <div className="card">
              <p className="text-sm text-danger">
                Couldn't load democracy state — check your connection and try again.
              </p>
            </div>
          ) : (
            <OverviewTab democracy={democracy} />
          )
        )}

        {tab === 'preimages' && (
          preimages.isLoading ? (
            <LoadingIndicator message="Loading preimages from chain..." />
          ) : preimages.error ? (
            <div className="card">
              <p className="text-sm text-danger">
                Couldn't load preimages — check your connection and try again.
              </p>
            </div>
          ) : (
            <PreimagesTab preimages={preimages.preimages} />
          )
        )}
      </div>
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
        active ? 'bg-ink-800 text-xx-500' : 'text-ink-300 active:bg-ink-800/50'
      )}
    >
      {label}
    </button>
  );
}

