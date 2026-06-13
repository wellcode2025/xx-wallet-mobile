import { useState } from 'react';
import clsx from 'clsx';
import {
  ChevronDown,
  ChevronRight,
  RefreshCcw,
  SlidersHorizontal,
} from 'lucide-react';
import type { AutoNominateValidator, AutoNominateTimings } from '@/staking';
import { useAutoSelection } from '@/hooks';
import { AddressLabel, LoadingIndicator } from '@/components/ui';
import { ValidatorStatsSheet } from './ValidatorStatsSheet';
import { AdvancedSelectionSheet } from './AdvancedSelectionSheet';

/**
 * Auto-recommend block — shared by Start staking and Change validators.
 *
 * Renders the auto-nominate result with enough context that the picks
 * aren't opaque: a plain-language "how these were chosen" explainer, each
 * validator's commission and rank inline, tap-to-inspect on any row, and
 * a single quiet "Advanced" entry point to the optional quality levers
 * (kept off the main flow so the default stays uncluttered).
 */
interface AutoNominateBlockProps {
  autoComputing: boolean;
  autoError: Error | null;
  autoResult: {
    selected: AutoNominateValidator[];
    allElected: AutoNominateValidator[];
    timings: AutoNominateTimings;
  } | null;
  onRefresh: () => void;
}

export function AutoNominateBlock({
  autoComputing,
  autoError,
  autoResult,
  onRefresh,
}: AutoNominateBlockProps) {
  const [showValidators, setShowValidators] = useState(true);
  const [showHow, setShowHow] = useState(false);
  const [statsAddress, setStatsAddress] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Levered selection (no-op when no levers are active).
  const selection = useAutoSelection(autoResult);

  if (autoComputing && !autoResult) {
    return (
      <div className="space-y-2">
        <LoadingIndicator message="Selecting validators for you..." />
        <p className="text-xs text-ink-400">
          This usually takes 30–60 seconds in the browser. The wallet pulls
          every bonded account, ledger, validator, and nominator from chain,
          runs the election locally, then scores each elected validator by
          recent performance, stake spread, and commission.
        </p>
      </div>
    );
  }

  if (autoError) {
    return (
      <div>
        <p className="text-sm text-danger">
          Couldn't select validators — {autoError.message}.
        </p>
        <button
          onClick={onRefresh}
          className="mt-2 text-sm text-xx-500 active:opacity-70"
        >
          Try again →
        </button>
      </div>
    );
  }

  if (!autoResult) return null;

  const picks = selection.selected;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-100">
          {picks.length} validator{picks.length === 1 ? '' : 's'} chosen for you
        </p>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-xs text-xx-500 active:opacity-70"
        >
          <RefreshCcw size={11} />
          Refresh
        </button>
      </div>

      <p className="text-xs text-ink-400">
        Selected in {(autoResult.timings.totalMs / 1000).toFixed(1)}s.
      </p>

      {/* Advanced entry point + live effect — single quiet line */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setAdvancedOpen(true)}
          className="flex items-center gap-1.5 text-xs text-ink-400 active:text-ink-200"
        >
          <SlidersHorizontal size={12} strokeWidth={1.75} />
          Advanced
          {selection.leverCount > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-xx-500" />
          )}
        </button>
        {selection.leverCount > 0 && selection.changedCount > 0 && (
          <span className="text-xs text-ink-400">
            {selection.changedCount} pick
            {selection.changedCount === 1 ? '' : 's'} changed
          </span>
        )}
      </div>

      {/* How these were chosen — plain-language explainer */}
      <div>
        <button
          onClick={() => setShowHow((s) => !s)}
          className="flex items-center gap-1 text-xs text-xx-500 active:opacity-70"
        >
          <ChevronDown
            size={12}
            className={clsx('transition-transform', showHow && 'rotate-180')}
          />
          How these were chosen
        </button>
        {showHow && (
          <p className="text-xs text-ink-400 mt-1 leading-relaxed">
            The wallet runs the network's own election locally, then ranks each
            validator by projected reward — its recent performance (reward
            points over the last ~7 eras), its commission, and how concentrated
            its stake already is. This favours strong, lower-commission
            validators that aren't oversubscribed. Validators that block
            nominations or are already full are skipped. Tap any validator below
            to see its full stats, or use Advanced to bias the picks.
          </p>
        )}
      </div>

      <button
        onClick={() => setShowValidators((s) => !s)}
        className="flex items-center gap-1 text-xs text-xx-500 active:opacity-70"
      >
        <ChevronDown
          size={12}
          className={clsx('transition-transform', showValidators && 'rotate-180')}
        />
        {showValidators ? 'Hide' : 'Show'} validators
      </button>

      {showValidators && (
        <ul className="rounded-2xl bg-ink-950 border border-ink-800 divide-y divide-ink-800/60">
          {picks.map((v, idx) => (
            <li key={v.validatorId}>
              <button
                onClick={() => setStatsAddress(v.validatorId)}
                className="w-full flex items-center gap-2 py-2.5 px-3 text-left active:bg-ink-800/40 transition-colors"
              >
                <span className="text-ink-300 text-xs w-5 flex-shrink-0">
                  {idx + 1}
                </span>
                <AddressLabel
                  address={v.validatorId}
                  nameOverride={v.displayName ?? undefined}
                  className="text-xs min-w-0 flex-1"
                />
                <span className="font-mono text-xs text-ink-400 numeric flex-shrink-0">
                  {v.commission.toFixed(0)}%
                </span>
                <ChevronRight size={14} className="text-ink-400 flex-shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ValidatorStatsSheet
        address={statsAddress}
        open={statsAddress !== null}
        onClose={() => setStatsAddress(null)}
      />

      <AdvancedSelectionSheet
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
      />
    </div>
  );
}
