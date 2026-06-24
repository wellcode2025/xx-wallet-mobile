/**
 * Coachmark — a one-time, dismissible explainer callout.
 *
 * For dense flows that benefit from a "here's how this works / step 1, 2, 3"
 * nudge the first time, without nagging afterwards. Dismissal is keyed by
 * `hintId` and persisted in settings (`dismissedHints`), so once the user taps
 * "Got it" (or the ×) it stays gone across sessions and devices-of-this-browser.
 * Renders nothing once dismissed.
 */
import { X } from 'lucide-react';
import { useSettingsStore } from '@/store';

export function Coachmark({
  hintId,
  title,
  icon,
  children,
}: {
  /** Stable id used to remember dismissal, e.g. "cmix-coordination-intro". */
  hintId: string;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const dismissed = useSettingsStore((s) => s.dismissedHints.includes(hintId));
  const dismissHint = useSettingsStore((s) => s.dismissHint);
  if (dismissed) return null;

  return (
    <div className="rounded-2xl border border-xx-500/30 bg-xx-500/5 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon}
          <p className="text-xs font-medium uppercase tracking-wider text-xx-500 truncate">
            {title}
          </p>
        </div>
        <button
          type="button"
          onClick={() => dismissHint(hintId)}
          className="text-ink-300 active:text-ink-100 flex-shrink-0 -mt-0.5 -mr-0.5 p-0.5"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
      <div className="text-xs text-ink-300 leading-relaxed">{children}</div>
      <button
        type="button"
        onClick={() => dismissHint(hintId)}
        className="text-xs font-medium text-xx-500 active:text-xx-600"
      >
        Got it
      </button>
    </div>
  );
}
