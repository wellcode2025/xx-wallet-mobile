import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { useSettingsStore } from '@/store';
import { leversActiveCount } from '@/staking';

/**
 * Advanced selection sheet — opt-in levers that re-rank the auto-nominate
 * picks. Kept out of the main flow (reached via a single "Advanced" link)
 * so the default experience stays uncluttered. Depth lives in
 * docs/validator-selection.md; the in-app copy stays to one-liners.
 */

const DOC_URL =
  'https://github.com/wellcode2025/xx-wallet-mobile/blob/main/docs/validator-selection.md';
const COMMISSION_MIN = 2; // xx enforces a 2% minimum commission
const COMMISSION_DEFAULT_CAP = 20;

interface AdvancedSelectionSheetProps {
  open: boolean;
  onClose: () => void;
}

export function AdvancedSelectionSheet({
  open,
  onClose,
}: AdvancedSelectionSheetProps) {
  const levers = useSettingsStore((s) => s.autoNominateLevers);
  const setLevers = useSettingsStore((s) => s.setAutoNominateLevers);
  const reset = useSettingsStore((s) => s.resetAutoNominateLevers);
  const [showHow, setShowHow] = useState(false);

  const active = leversActiveCount(levers);
  const capOn = levers.maxCommission !== null;

  return (
    <Sheet open={open} onClose={onClose} title="Advanced selection">
      <div className="space-y-4">
        <p className="text-xs text-ink-300 leading-relaxed">
          These change how the wallet ranks validators for your nomination.
          The defaults work well for most people — only adjust them if you
          understand the trade-offs. Your stake goes to whoever ends up
          selected.
        </p>

        <ToggleRow
          label="Prefer validators with an identity"
          caption="Favour operators who've registered an on-chain name."
          value={levers.preferIdentity}
          onChange={(v) => setLevers({ preferIdentity: v })}
        />

        <ToggleRow
          label="Prefer less-saturated validators"
          caption="Favour those with fewer backers — better stake spread."
          value={levers.preferLessSaturated}
          onChange={(v) => setLevers({ preferLessSaturated: v })}
        />

        <div className="space-y-2">
          <ToggleRow
            label="Limit commission"
            caption="Only consider validators at or below your cap."
            value={capOn}
            onChange={(v) =>
              setLevers({ maxCommission: v ? COMMISSION_DEFAULT_CAP : null })
            }
          />
          {capOn && (
            <div className="flex items-center gap-3 pl-1">
              <input
                type="range"
                min={COMMISSION_MIN}
                max={100}
                step={1}
                value={levers.maxCommission ?? COMMISSION_DEFAULT_CAP}
                onChange={(e) =>
                  setLevers({ maxCommission: Number(e.target.value) })
                }
                className="flex-1 accent-xx-500"
                aria-label="Maximum commission"
              />
              <span className="font-mono text-sm text-ink-100 numeric w-14 text-right">
                ≤ {levers.maxCommission}%
              </span>
            </div>
          )}
        </div>

        {/* Concise in-app explainer; full detail on GitHub */}
        <div>
          <button
            onClick={() => setShowHow((s) => !s)}
            className="flex items-center gap-1 text-xs text-xx-500 active:opacity-70"
          >
            <ChevronDown
              size={12}
              className={clsx('transition-transform', showHow && 'rotate-180')}
            />
            How these work
          </button>
          {showHow && (
            <p className="text-xs text-ink-300 mt-1 leading-relaxed">
              The picker ranks validators by projected reward (recent
              performance, commission, and stake spread). These levers nudge
              that ranking: the first two are soft preferences that favour —
              but don't require — the chosen trait, so you still get a full
              set of 16; the commission limit is a hard cap. Changes apply
              instantly to the same candidates, with no re-scan.
            </p>
          )}
        </div>

        <a
          href={DOC_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-ink-300 active:text-xx-500"
        >
          Full explanation on GitHub
          <ExternalLink size={12} strokeWidth={1.75} />
        </a>

        {active > 0 && (
          <button
            onClick={reset}
            className="block w-full mt-2 py-2.5 rounded-2xl border border-ink-700 text-sm text-ink-200 active:bg-ink-800/40"
          >
            Reset to defaults
          </button>
        )}
      </div>
    </Sheet>
  );
}

function ToggleRow({
  label,
  caption,
  value,
  onChange,
}: {
  label: string;
  caption: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-ink-100">{label}</p>
        <p className="text-xs text-ink-300">{caption}</p>
      </div>
      <button
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={clsx(
          'relative shrink-0 w-11 h-6 rounded-full transition-colors',
          value ? 'bg-xx-500' : 'bg-ink-700'
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-ink-950 transition-transform',
            value && 'translate-x-5'
          )}
        />
      </button>
    </div>
  );
}
