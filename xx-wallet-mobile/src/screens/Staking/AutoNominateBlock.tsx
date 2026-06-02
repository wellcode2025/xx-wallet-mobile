import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, RefreshCcw } from 'lucide-react';
import type { AutoNominateValidator, AutoNominateTimings } from '@/staking';
import { AddressLabel, LoadingIndicator } from '@/components/ui';
import { ValidatorStatsSheet } from './ValidatorStatsSheet';

/**
 * Auto-recommend block — shared by Start staking and Change validators.
 *
 * Renders the auto-nominate result with enough context that the picks
 * aren't opaque: a plain-language "how these were chosen" explainer, each
 * validator's commission and rank inline, and tap-to-inspect on any row
 * (opens a flow-safe stats sheet rather than navigating away).
 */
interface AutoNominateBlockProps {
  autoComputing: boolean;
  autoError: Error | null;
  autoResult: {
    selected: AutoNominateValidator[];
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-100">
          {autoResult.selected.length} validators chosen for you
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
            to see its full stats, or switch to Hand-pick to choose your own.
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
          {autoResult.selected.map((v, idx) => (
            <li key={v.validatorId}>
              <button
                onClick={() => setStatsAddress(v.validatorId)}
                className="w-full flex items-center gap-2 py-2.5 px-3 text-left active:bg-ink-800/40 transition-colors"
              >
                <span className="text-ink-500 text-xs w-5 flex-shrink-0">
                  {idx + 1}
                </span>
                <AddressLabel
                  address={v.validatorId}
                  className="text-xs min-w-0 flex-1"
                />
                <span className="font-mono text-xs text-ink-400 numeric flex-shrink-0">
                  {v.commission.toFixed(0)}%
                </span>
                <ChevronRight
                  size={14}
                  className="text-ink-500 flex-shrink-0"
                />
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
    </div>
  );
}
