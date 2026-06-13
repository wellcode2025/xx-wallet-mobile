import { Link } from 'react-router-dom';
import { BN } from '@polkadot/util';
import { AlertTriangle, ShieldOff, X } from 'lucide-react';

import { useAlertsStore, type Alert } from '@/store';
import { formatBalance } from '@/utils';
import { AddressLabel } from '@/components/ui';

/**
 * Banner surface for slash alerts on MyNominations.
 *
 * Reads useAlertsStore directly (no chain queries). The inlineSink in
 * src/notifications/inlineSink.ts is what writes to that store when
 * useSlashNotifications observes a SlashReported or Slashed event.
 *
 * For slash-reported alerts: bright warning, lists the validator, the
 * remaining defer-eras-as-days, and links the user to the Change
 * validators flow so they can chill / re-nominate before the slash
 * applies. Manually dismissible.
 *
 * For slash-applied alerts: post-mortem signal, paler treatment,
 * dismissible.
 *
 * Hidden entirely when there are no active alerts.
 */
export interface RecentAlertsBannerProps {
  /** Current active era — used to prune alerts whose applicableEra
   *  has passed. */
  activeEra: number | null;
  /** The user account this MyNominations is showing. Banner filters
   *  to alerts affecting this account so other accounts' alerts
   *  don't bleed in. */
  forAddress: string;
}

export function RecentAlertsBanner({
  activeEra,
  forAddress,
}: RecentAlertsBannerProps) {
  const active = useAlertsStore((s) => s.activeFor(activeEra));
  const dismiss = useAlertsStore((s) => s.dismiss);
  const relevant = active.filter((a) =>
    a.kind === 'slash.reported'
      ? a.affectedUserAddress === forAddress
      : a.stakerAddress === forAddress
  );
  if (relevant.length === 0) return null;
  return (
    <div className="space-y-2">
      {relevant.map((alert) => (
        <AlertCard
          key={alert.id}
          alert={alert}
          activeEra={activeEra}
          onDismiss={() => dismiss(alert.id)}
        />
      ))}
    </div>
  );
}

function AlertCard({
  alert,
  activeEra,
  onDismiss,
}: {
  alert: Alert;
  activeEra: number | null;
  onDismiss: () => void;
}) {
  if (alert.kind === 'slash.reported') {
    const daysLeft =
      activeEra !== null ? Math.max(0, alert.applicableEra - activeEra) : null;
    return (
      <div className="rounded-2xl bg-warning/10 border border-warning/30 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={18}
            strokeWidth={2}
            className="text-warning flex-shrink-0 mt-0.5"
          />
          <div className="flex-1 min-w-0 space-y-2">
            <div>
              <p className="font-display font-medium text-sm text-ink-100">
                {alert.isOwnValidator
                  ? 'Your validator was reported for an offence'
                  : 'A validator you nominate was reported'}
              </p>
              <p className="text-xs text-ink-300 mt-1">
                {daysLeft !== null && daysLeft > 0
                  ? `Slash applies in ${daysLeft} day${daysLeft === 1 ? '' : 's'} unless deferred.`
                  : 'Slash applies imminently.'}{' '}
                Reported in era {alert.slashEra}, fraction{' '}
                {(alert.fraction / 1e7).toFixed(2)}%.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-ink-300">
              <span>Validator:</span>
              <AddressLabel
                address={alert.validatorAddress}
                className="text-xs text-ink-200 min-w-0"
              />
            </div>
            {!alert.isOwnValidator && (
              <Link
                to="/staking/change"
                className="inline-flex items-center gap-1 text-xs text-warning underline active:opacity-70"
              >
                Change validators →
              </Link>
            )}
            {alert.isOwnValidator && (
              <p className="text-xs text-ink-300">
                Your validator stash is at risk — chilling won't undo the
                offence, but you can review your node operations.
              </p>
            )}
          </div>
          <button
            onClick={onDismiss}
            className="text-ink-300 active:text-ink-300 flex-shrink-0"
            aria-label="Dismiss alert"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-danger/10 border border-danger/30 p-4">
      <div className="flex items-start gap-3">
        <ShieldOff
          size={18}
          strokeWidth={2}
          className="text-danger flex-shrink-0 mt-0.5"
        />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="font-display font-medium text-sm text-ink-100">
            Stake slashed
          </p>
          <p className="text-xs text-ink-300">
            {formatBalance(new BN(alert.amount), {
              decimals: 4,
              withSymbol: true,
            })}{' '}
            was deducted from your bonded stake at block #
            {alert.blockNumber.toLocaleString()}.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-ink-300 active:text-ink-300 flex-shrink-0"
          aria-label="Dismiss alert"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
