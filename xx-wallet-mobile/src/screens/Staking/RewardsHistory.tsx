import { useMemo } from 'react';
import { ExternalLink, Coins } from 'lucide-react';
import { BN } from '@polkadot/util';
import { useAccountsStore } from '@/store';
import { useRewardsHistory, type RewardsHistory as RewardsHistoryShape, type RewardRow } from '@/hooks';
import { formatBalance } from '@/utils';
import {
  AddressLabel,
  LoadingIndicator,
  SparkBarChart,
} from '@/components/ui';

/**
 * Staking section — Rewards History sub-view (slice 4).
 *
 * Per-account staking rewards over the last 90 eras. Indexer-first —
 * the spike confirmed `staking_reward` tracks chain liveness (1-era
 * lag), so this view shows live-quality data with no staleness frame.
 *
 * Account-scoped to the active wallet account. useRewardsHistory is
 * account-agnostic; the multisig detail screen can reuse it later by
 * passing a multisig address.
 */
export function RewardsHistory() {
  const { accounts, activeAddress } = useAccountsStore();
  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? accounts[0],
    [accounts, activeAddress]
  );

  const { history, isLoading, error } = useRewardsHistory(
    activeAccount?.address ?? null
  );

  if (!activeAccount) {
    // Route guard should prevent this, but be defensive.
    return null;
  }

  return (
    <div className="px-5 py-4 space-y-5">
      {isLoading && !history && (
        <>
          <LoadingIndicator message="Loading your rewards..." />
          <RewardsSkeleton />
        </>
      )}

      {error && (
        <div className="card">
          <p className="text-sm text-danger">
            Couldn't load rewards history — check your connection and try
            again.
          </p>
        </div>
      )}

      {history && !error && (
        history.rows.length > 0 ? (
          <Populated
            address={activeAccount.address}
            history={history}
          />
        ) : (
          <Empty />
        )
      )}
    </div>
  );
}

function Populated({
  address,
  history,
}: {
  address: string;
  history: RewardsHistoryShape;
}) {
  const { rows, totalOverWindow, eraCount, eraRange } = history;
  const avgPerEra = eraCount > 0
    ? totalOverWindow.divn(eraCount)
    : new BN(0);

  // For the chart: aggregate per era (a nominator backing multiple
  // validators gets one row per validator per era). One bar per era.
  const chartData = useMemo(() => {
    const byEra = new Map<number, BN>();
    for (const r of rows) {
      byEra.set(r.era, (byEra.get(r.era) ?? new BN(0)).add(r.amount));
    }
    return Array.from(byEra.entries())
      .map(([era, total]) => ({
        era,
        // Use whole-XX for the chart scale (raw planck is too coarse a
        // dynamic range for a 64-px-tall bar chart).
        points: total.div(new BN(1_000_000_000)).toNumber(),
      }))
      .sort((a, b) => a.era - b.era);
  }, [rows]);

  return (
    <>
      {/* Summary */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Last 90 eras
          </span>
          {eraRange && (
            <span className="text-xs text-ink-400">
              Eras {eraRange[0]} – {eraRange[1]}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium mb-0.5">
              Total earned
            </p>
            <p className="font-mono text-sm text-ink-100 numeric">
              {formatBalance(totalOverWindow, {
                decimals: 4,
                withSymbol: true,
              })}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium mb-0.5">
              Avg per era
            </p>
            <p className="font-mono text-sm text-ink-100 numeric">
              {formatBalance(avgPerEra, { decimals: 4, withSymbol: true })}
            </p>
          </div>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Earned per era · last {chartData.length} era
            {chartData.length === 1 ? '' : 's'}
          </p>
          <SparkBarChart
            data={chartData}
            height={64}
            ariaLabel={`Rewards-per-era bar chart, ${chartData.length} eras`}
          />
        </div>
      )}

      {/* Row list */}
      <div className="card">
        <h3 className="font-display font-medium text-sm text-ink-200 mb-3">
          {rows.length} payout{rows.length === 1 ? '' : 's'}
        </h3>
        <ul>
          {rows.map((r) => (
            <RewardItem key={`${r.era}-${r.blockNumber}-${r.validator}`} row={r} />
          ))}
        </ul>
      </div>

      {/* Explorer link out */}
      <a
        href={`https://explorer.xx.network/accounts/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 text-sm text-xx-500 active:opacity-70 py-2"
      >
        View full history on explorer.xx.network
        <ExternalLink size={14} />
      </a>
    </>
  );
}

function RewardItem({ row }: { row: RewardRow }) {
  const date =
    row.timestamp > 0
      ? new Date(row.timestamp).toISOString().slice(0, 10)
      : null;
  return (
    <li className="py-3 border-b border-ink-800/60 last:border-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-sm text-ink-100">
          Era {row.era}
          {date && <span className="text-ink-400"> · {date}</span>}
        </span>
        <span className="font-mono text-sm text-ink-100 numeric flex-shrink-0">
          +{formatBalance(row.amount, { decimals: 4, withSymbol: true })}
        </span>
      </div>
      <AddressLabel address={row.validator} className="text-xs text-ink-400" />
    </li>
  );
}

function Empty() {
  return (
    <div className="card flex flex-col items-center text-center gap-3 py-8">
      <div className="w-14 h-14 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center">
        <Coins size={24} strokeWidth={1.5} className="text-ink-400" />
      </div>
      <div className="space-y-1 max-w-xs">
        <p className="font-display font-medium text-sm text-ink-100">
          No rewards in the last 90 eras
        </p>
        <p className="text-sm text-ink-400">
          This account hasn't earned staking rewards in the visible
          window. Start nominating to earn rewards — bonding arrives in
          Phase 3.
        </p>
      </div>
    </div>
  );
}

function RewardsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="card h-20 animate-pulse-subtle" />
      <div className="card h-24 animate-pulse-subtle" />
      <div className="card space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="h-3 rounded bg-ink-700/50 animate-pulse-subtle w-2/5" />
            <div className="h-3 rounded bg-ink-700/50 animate-pulse-subtle w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
