import { useState } from 'react';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { BN } from '@polkadot/util';
import { TopBar } from '@/components/layout';
import { LoadingIndicator } from '@/components/ui';
import { useTreasury, useTips } from '@/hooks';
import { useConnectionStore } from '@/store';
import { cycleProgress } from '@/governance';
import { formatBalance } from '@/utils';
import { ProposalsTab } from './ProposalsTab';
import { TipsTab } from './TipsTab';
import { ProposeSpendSheet } from './ProposeSpendSheet';

/**
 * Treasury + Tips screen.
 *
 * `/governance/treasury`. Mirrors the official xx web wallet's
 * Treasury page with the Tips sub-tab consolidated alongside (the web
 * wallet has Tips as a separate top-of-page tab; we group them here
 * to keep the Governance index manageable).
 *
 * Pot balance is derived: read consts.treasury.palletId, run it
 * through deriveModuleAccount (substrate into_account_truncating),
 * query system.account at that address. The treasury pallet doesn't
 * expose its account directly anywhere on chain.
 *
 * "Next burn" is the amount that will be burned from the pot at the
 * next spend tick if no proposals consume it: pot * burnPerMill / 1M.
 * xx's burn rate at observation is 10,000 ppm = 1%.
 */

type Tab = 'proposals' | 'tips';

export function TreasuryOverview() {
  const treasury = useTreasury();
  const tips = useTips();
  const blockNumber = useConnectionStore((s) => s.blockNumber);
  const [tab, setTab] = useState<Tab>('proposals');
  const [proposeOpen, setProposeOpen] = useState(false);

  const spendInfo =
    blockNumber != null && treasury.spendPeriod > 0
      ? cycleProgress(blockNumber, treasury.spendPeriod, 'spend')
      : null;

  // Next burn = pot * burn / 1,000,000 (Permill).
  const nextBurn =
    treasury.potBalance && treasury.burnPerMill > 0
      ? treasury.potBalance.mul(new BN(treasury.burnPerMill)).div(new BN(1_000_000))
      : null;

  return (
    <>
      <TopBar title="Treasury" showBack />
      <div className="px-5 py-4 space-y-4 max-w-md mx-auto pb-8">
        <div className="rounded-2xl border border-ink-800 bg-ink-900/40 p-4 space-y-3">
          <div>
            <p className="text-xs text-ink-400">Spendable pot</p>
            <p className="font-mono text-2xl text-ink-100 numeric">
              {treasury.isLoading
                ? '…'
                : treasury.potBalance
                ? formatBalance(treasury.potBalance, {
                    decimals: 4,
                    trim: true,
                    grouping: true,
                  })
                : '—'}{' '}
              <span className="text-sm text-ink-400">XX</span>
            </p>
          </div>
          {nextBurn && treasury.burnPerMill > 0 && (
            <p className="text-xs text-ink-400">
              Next burn at spend tick:{' '}
              <span className="font-mono text-ink-200">
                {formatBalance(nextBurn, {
                  decimals: 4,
                  trim: true,
                  grouping: true,
                })}{' '}
                XX
              </span>{' '}
              ({formatBurnPercent(treasury.burnPerMill)})
            </p>
          )}
        </div>

        {spendInfo && (
          <div className="rounded-2xl border border-ink-800 bg-ink-900/40 p-3">
            <p className="text-xs text-ink-400">Spend period</p>
            <p className="mt-0.5 text-sm text-ink-100">
              <span className="font-medium">{spendInfo.remainingLabel}</span>
              <span className="text-ink-400"> · cycle {spendInfo.cycle}</span>
            </p>
            <div className="mt-2 h-1 rounded-full bg-ink-800 overflow-hidden">
              <div
                className="h-full bg-xx-500/60"
                style={{ width: `${spendInfo.progressPct}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex gap-1 p-1 rounded-2xl bg-ink-900 border border-ink-800">
          <TabButton
            label={`Proposals${
              treasury.pendingProposals.length
                ? ` · ${treasury.pendingProposals.length}`
                : ''
            }`}
            active={tab === 'proposals'}
            onClick={() => setTab('proposals')}
          />
          <TabButton
            label={`Tips${tips.tips.length ? ` · ${tips.tips.length}` : ''}`}
            active={tab === 'tips'}
            onClick={() => setTab('tips')}
          />
        </div>

        {tab === 'proposals' && (
          <button
            onClick={() => setProposeOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-sm text-xx-500 font-medium active:bg-ink-800 transition-colors"
          >
            <Plus size={14} strokeWidth={2} />
            Propose spend
          </button>
        )}

        {tab === 'proposals' && (
          treasury.isLoading ? (
            <LoadingIndicator message="Loading treasury proposals..." />
          ) : treasury.error ? (
            <div className="card">
              <p className="text-sm text-danger">
                Couldn't load treasury state — check your connection and try again.
              </p>
              <p className="mt-2 text-xs text-ink-400 font-mono break-all">
                {treasury.error.message || String(treasury.error)}
              </p>
            </div>
          ) : (
            <ProposalsTab treasury={treasury} />
          )
        )}

        {tab === 'tips' && (
          tips.isLoading ? (
            <LoadingIndicator message="Loading tips from chain..." />
          ) : tips.error ? (
            <div className="card">
              <p className="text-sm text-danger">
                Couldn't load tips — check your connection and try again.
              </p>
              <p className="mt-2 text-xs text-ink-400 font-mono break-all">
                {tips.error.message || String(tips.error)}
              </p>
            </div>
          ) : (
            <TipsTab tips={tips} />
          )
        )}
      </div>

      <ProposeSpendSheet
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
        active ? 'bg-ink-800 text-xx-500' : 'text-ink-400 active:bg-ink-800/50'
      )}
    >
      {label}
    </button>
  );
}

/**
 * Render a Permill value (parts-per-million) as a human percentage.
 * 10,000 → "1%"  ·  1,000 → "0.1%"  ·  100,000 → "10%"
 */
function formatBurnPercent(perMill: number): string {
  const pct = perMill / 10_000;
  if (pct >= 1) return `${pct.toFixed(pct % 1 === 0 ? 0 : 2)}%`;
  return `${pct.toFixed(3)}%`;
}
