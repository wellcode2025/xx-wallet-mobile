import { useState } from 'react';
import clsx from 'clsx';
import { TopBar } from '@/components/layout';
import { LoadingIndicator } from '@/components/ui';
import { useCouncil } from '@/hooks';
import { useConnectionStore } from '@/store';
import { cycleProgress } from '@/governance';
import { MembersTab } from './MembersTab';
import { CommitteeTab } from './CommitteeTab';

/**
 * Phase 4 Slice 3 — Council + Technical Committee screen.
 *
 * `/governance/council`. Mirrors the official xx web wallet's Council
 * page, with Tech. comm. consolidated as a second tab (the 4
 * tech-comm members on xx are a strict subset of the 13 council
 * members, so two distinct screens would mostly be redundant on
 * mobile real estate).
 *
 * The term-progress bar uses cycleProgress with `noun: 'election'` —
 * same helper that powers Democracy's launch-period bar. Council
 * elections fire at every `elections.termDuration` block (100,800 on
 * xx = 7 days).
 */

// Re-exported so MembersTab + CommitteeTab can type-import without a
// circular import on useCouncil.
export type UseCouncilResult = ReturnType<typeof useCouncil>;

type Tab = 'members' | 'committee';

export function CouncilOverview() {
  const council = useCouncil();
  const blockNumber = useConnectionStore((s) => s.blockNumber);
  const [tab, setTab] = useState<Tab>('members');

  const termInfo =
    blockNumber != null && council.termDuration > 0
      ? cycleProgress(blockNumber, council.termDuration, 'election')
      : null;

  return (
    <>
      <TopBar title="Council" showBack />
      <div className="px-5 py-4 space-y-4 max-w-md mx-auto pb-8">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-ink-300">
            <span className="text-ink-100 font-medium">
              {council.isLoading ? '…' : council.members.length}
            </span>{' '}
            seats ·{' '}
            <span className="text-ink-100 font-medium">
              {council.isLoading ? '…' : council.runnersUp.length}
            </span>{' '}
            runners-up ·{' '}
            <span className="text-ink-100 font-medium">
              {council.isLoading ? '…' : council.techComm.members.length}
            </span>{' '}
            committee
          </p>
        </div>

        {termInfo && (
          <div className="rounded-2xl border border-ink-800 bg-ink-900/40 p-3">
            <p className="text-xs text-ink-400">Term progress</p>
            <p className="mt-0.5 text-sm text-ink-100">
              <span className="font-medium">{termInfo.remainingLabel}</span>
              <span className="text-ink-400"> · cycle {termInfo.cycle}</span>
            </p>
            <div className="mt-2 h-1 rounded-full bg-ink-800 overflow-hidden">
              <div
                className="h-full bg-xx-500/60"
                style={{ width: `${termInfo.progressPct}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-1 p-1 rounded-2xl bg-ink-900 border border-ink-800">
          <TabButton
            label={`Members${
              council.members.length ? ` · ${council.members.length}` : ''
            }`}
            active={tab === 'members'}
            onClick={() => setTab('members')}
          />
          <TabButton
            label={`Committee${
              council.techComm.members.length
                ? ` · ${council.techComm.members.length}`
                : ''
            }`}
            active={tab === 'committee'}
            onClick={() => setTab('committee')}
          />
        </div>

        {council.isLoading ? (
          <LoadingIndicator message="Loading council from chain..." />
        ) : council.error ? (
          <div className="card">
            <p className="text-sm text-danger">
              Couldn't load council state — check your connection and try again.
            </p>
          </div>
        ) : tab === 'members' ? (
          <MembersTab council={council} />
        ) : (
          <CommitteeTab council={council} />
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
        active ? 'bg-ink-800 text-xx-500' : 'text-ink-400 active:bg-ink-800/50'
      )}
    >
      {label}
    </button>
  );
}
