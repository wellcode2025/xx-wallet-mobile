import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ArrowDown, ArrowUp } from 'lucide-react';
import clsx from 'clsx';
import { useValidatorList, type ValidatorListEntry } from '@/hooks';
import { formatBalance } from '@/utils';
import { AddressIcon, AddressLabel, LoadingIndicator } from '@/components/ui';

/**
 * Staking section — Validator List sub-view (slice 2).
 *
 * The network-wide validator set with live commission, total stake,
 * and era points. Searchable by name/address, sortable by stake /
 * commission / era points.
 *
 * Data comes from useValidatorList: chain-first (the slice-2 spike
 * found the indexer's validator_stats lags ~255 eras, so it can't
 * carry the live set), with the indexer supplying only identity
 * display names. The xx-specific enrichment (location,
 * relative_performance) is deferred to the validator detail screen
 * (slice 3), where a historical-snapshot frame fits it.
 *
 * Rows tap through to /staking/validators/:address (slice 3 detail).
 */

type SortKey = 'stake' | 'commission' | 'points';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'stake', label: 'Stake' },
  { key: 'commission', label: 'Commission' },
  { key: 'points', label: 'Era points' },
];

export function ValidatorList() {
  const { validators, isLoading, error } = useValidatorList();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('stake');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = validators;
    if (q) {
      list = list.filter(
        (v) =>
          v.displayName?.toLowerCase().includes(q) ||
          v.address.toLowerCase().includes(q)
      );
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'stake') {
        const av = a.totalStake;
        const bv = b.totalStake;
        if (av && bv) cmp = av.cmp(bv);
        else if (av) cmp = 1;
        else if (bv) cmp = -1;
      } else if (sortKey === 'commission') {
        cmp = a.commission - b.commission;
      } else {
        cmp = a.eraPoints - b.eraPoints;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [validators, search, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  return (
    <div className="px-5 py-4 space-y-4">
      {/* Search */}
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none"
        />
        <input
          type="text"
          inputMode="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or address"
          className="w-full pl-9 pr-3 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-sm text-ink-100 placeholder:text-ink-400 focus:outline-none focus:border-ink-600"
        />
      </div>

      {/* Sort chips */}
      <div className="flex gap-2">
        {SORT_OPTIONS.map(({ key, label }) => {
          const active = sortKey === key;
          return (
            <button
              key={key}
              onClick={() => onSort(key)}
              className={clsx(
                'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                active
                  ? 'bg-xx-500/10 text-xx-500 border-xx-500/30'
                  : 'bg-ink-900 text-ink-400 border-ink-800 active:bg-ink-800'
              )}
            >
              {label}
              {active &&
                (sortDir === 'desc' ? (
                  <ArrowDown size={11} strokeWidth={2.5} />
                ) : (
                  <ArrowUp size={11} strokeWidth={2.5} />
                ))}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <>
          <LoadingIndicator message="Loading validator list — this may take a moment..." />
          <ValidatorListSkeleton />
        </>
      )}

      {error && !isLoading && (
        <div className="card">
          <p className="text-sm text-danger">
            Couldn't load validators — check your connection and try again.
          </p>
        </div>
      )}

      {!isLoading && !error && (
        <>
          <p className="text-xs text-ink-400">
            {search.trim()
              ? `${filtered.length} of ${validators.length} validators`
              : `${validators.length} validators`}
          </p>
          {filtered.length === 0 ? (
            <div className="card">
              <p className="text-sm text-ink-400">
                {validators.length === 0
                  ? 'No validators found.'
                  : `No validators match "${search.trim()}".`}
              </p>
            </div>
          ) : (
            <div className="card">
              <ul>
                {filtered.map((v) => (
                  <ValidatorRow key={v.address} validator={v} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ValidatorRow({ validator }: { validator: ValidatorListEntry }) {
  return (
    <li className="border-b border-ink-800/60 last:border-0">
      <Link
        to={`/staking/validators/${validator.address}`}
        className="flex items-center gap-3 py-3 -mx-3 px-3 rounded-xl active:bg-ink-800/40 transition-colors"
      >
        <AddressIcon address={validator.address} size={36} />
        <div className="flex-1 min-w-0">
          <AddressLabel
            address={validator.address}
            nameOverride={validator.displayName ?? undefined}
            stacked
            className="text-sm"
          />
          {(validator.blocked || !validator.isActive) && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {validator.blocked && (
                <span className="px-1.5 py-0.5 rounded text-xs bg-ink-800 text-ink-400 border border-ink-700/50">
                  Blocked
                </span>
              )}
              {!validator.isActive && (
                <span className="px-1.5 py-0.5 rounded text-xs bg-ink-800 text-warning border border-ink-700/50">
                  Inactive this era
                </span>
              )}
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-mono text-sm text-ink-100 numeric">
            {validator.totalStake
              ? formatBalance(validator.totalStake, {
                  decimals: 0,
                  withSymbol: true,
                })
              : '—'}
          </p>
          <p className="text-xs text-ink-400 mt-0.5 numeric">
            {validator.commission.toFixed(0)}% ·{' '}
            {validator.eraPoints.toLocaleString()} pts
          </p>
        </div>
      </Link>
    </li>
  );
}

function ValidatorListSkeleton() {
  return (
    <div className="card">
      <ul>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <li
            key={i}
            className="flex items-center gap-3 py-3 border-b border-ink-800/60 last:border-0"
          >
            <div className="w-9 h-9 rounded-full bg-ink-700/50 animate-pulse-subtle" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 rounded bg-ink-700/50 animate-pulse-subtle w-1/2" />
              <div className="h-2.5 rounded bg-ink-700/30 animate-pulse-subtle w-1/3" />
            </div>
            <div className="space-y-1.5">
              <div className="h-3 rounded bg-ink-700/50 animate-pulse-subtle w-20" />
              <div className="h-2.5 rounded bg-ink-700/30 animate-pulse-subtle w-12 ml-auto" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
