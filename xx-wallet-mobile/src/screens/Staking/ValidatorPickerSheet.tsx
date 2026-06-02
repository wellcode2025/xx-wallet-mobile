import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Check, Info, Search } from 'lucide-react';
import { useValidatorList, type ValidatorListEntry } from '@/hooks';
import { formatBalance } from '@/utils';
import {
  AddressIcon,
  AddressLabel,
  LoadingIndicator,
  Sheet,
} from '@/components/ui';
import { ValidatorStatsSheet } from './ValidatorStatsSheet';

/**
 * Validator picker — hand-pick path for the bond flow.
 *
 * Wraps the live validator list (chain-first via useValidatorList) with
 * a multi-select interaction capped at the chain's maxNominations (16).
 * Tapping the main row area toggles selection; a separate info button
 * opens a flow-safe ValidatorStatsSheet on top so users can inspect a
 * validator without losing their selection.
 *
 * Sort and search mirror the standalone ValidatorList screen so users
 * who already know that surface find this one familiar.
 */

type SortKey = 'stake' | 'commission' | 'points';

const MAX_SELECTABLE = 16;
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'stake', label: 'Stake' },
  { key: 'commission', label: 'Commission' },
  { key: 'points', label: 'Era points' },
];

export interface ValidatorPickerSheetProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selected validator addresses (e.g. when re-opening the sheet). */
  initial: string[];
  /** Called with the final selection when the user taps Done. */
  onConfirm: (selected: string[]) => void;
}

export function ValidatorPickerSheet({
  open,
  onClose,
  initial,
  onConfirm,
}: ValidatorPickerSheetProps) {
  const { validators, isLoading, error } = useValidatorList();
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('stake');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Validator whose stats sheet is open (null = closed). Inspecting a
  // validator must not disturb the in-progress multi-select.
  const [statsAddress, setStatsAddress] = useState<string | null>(null);

  // Reset selection state to match `initial` whenever the sheet opens.
  // Otherwise reopening after a previous interaction would carry stale
  // toggles from the cancelled session.
  useEffect(() => {
    if (open) setSelected(new Set(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const toggleValidator = (address: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(address)) {
        next.delete(address);
      } else if (next.size < MAX_SELECTABLE) {
        next.add(address);
      }
      return next;
    });
  };

  const handleDone = () => {
    onConfirm(Array.from(selected));
  };

  return (
    <>
    <Sheet open={open} onClose={onClose} title="Choose validators">
      <div className="px-5 pb-5 space-y-3">
        {/* Selection bar */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-ink-300">
            <span className="font-mono">{selected.size}</span> /{' '}
            <span className="font-mono">{MAX_SELECTABLE}</span> selected
          </p>
          <button
            onClick={handleDone}
            disabled={selected.size === 0}
            className={clsx(
              'px-4 py-2 rounded-full text-sm font-medium transition-opacity',
              selected.size === 0
                ? 'bg-ink-800 text-ink-500 cursor-not-allowed'
                : 'bg-xx-500 text-ink-950 active:opacity-80'
            )}
          >
            Done
          </button>
        </div>

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
            className="w-full pl-9 pr-3 py-2.5 rounded-2xl bg-ink-950 border border-ink-800 text-sm text-ink-100 placeholder:text-ink-400 focus:outline-none focus:border-ink-600"
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
                    : 'bg-ink-950 text-ink-400 border-ink-800 active:bg-ink-800'
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
          <LoadingIndicator message="Loading validators..." />
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
            <div className="rounded-2xl bg-ink-950 border border-ink-800">
              <ul>
                {filtered.map((v) => (
                  <PickerRow
                    key={v.address}
                    validator={v}
                    selected={selected.has(v.address)}
                    disabled={
                      !selected.has(v.address) && selected.size >= MAX_SELECTABLE
                    }
                    onToggle={() => toggleValidator(v.address)}
                    onInfo={() => setStatsAddress(v.address)}
                  />
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </Sheet>

      <ValidatorStatsSheet
        elevated
        address={statsAddress}
        open={statsAddress !== null}
        onClose={() => setStatsAddress(null)}
      />
    </>
  );
}

function PickerRow({
  validator,
  selected,
  disabled,
  onToggle,
  onInfo,
}: {
  validator: ValidatorListEntry;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onInfo: () => void;
}) {
  return (
    <li
      className={clsx(
        'flex items-stretch border-b border-ink-800/60 last:border-0',
        selected && 'bg-xx-500/10'
      )}
    >
      {/* Select toggle — the main row area */}
      <button
        onClick={onToggle}
        disabled={disabled}
        className={clsx(
          'flex-1 min-w-0 flex items-center gap-3 py-3 pl-3 pr-2 rounded-l-xl transition-colors text-left',
          selected
            ? 'active:bg-xx-500/15'
            : disabled
              ? 'opacity-40 cursor-not-allowed'
              : 'active:bg-ink-800/40'
        )}
      >
        {/* Selection indicator */}
        <div
          className={clsx(
            'w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center border-2',
            selected
              ? 'bg-xx-500 border-xx-500'
              : 'border-ink-600'
          )}
        >
          {selected && <Check size={12} strokeWidth={3} className="text-ink-950" />}
        </div>

        <AddressIcon address={validator.address} size={28} />
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
                  Inactive
                </span>
              )}
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-mono text-xs text-ink-300 numeric">
            {validator.totalStake
              ? formatBalance(validator.totalStake, {
                  decimals: 0,
                  withSymbol: true,
                })
              : '—'}
          </p>
          <p className="text-xs text-ink-400 mt-0.5 numeric">
            {validator.commission.toFixed(0)}%
          </p>
        </div>
      </button>

      {/* Info — opens stats without toggling selection. Always enabled,
          even when the row can't be selected (16-cap reached). */}
      <button
        onClick={onInfo}
        aria-label="View validator stats"
        className="flex items-center px-3 text-ink-400 active:text-ink-100 active:bg-ink-800/40 transition-colors"
      >
        <Info size={16} strokeWidth={1.75} />
      </button>
    </li>
  );
}
