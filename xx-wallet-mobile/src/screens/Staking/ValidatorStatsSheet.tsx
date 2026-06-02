import { useValidatorDetail, type ValidatorDetail } from '@/hooks';
import { formatBalance } from '@/utils';
import {
  AddressIcon,
  AddressLabel,
  LoadingIndicator,
  SparkBarChart,
  Sheet,
} from '@/components/ui';

/**
 * Validator stats — a flow-safe summary shown as a sheet.
 *
 * Used wherever the user is mid-flow (the bond/nominate auto-pick list and
 * the hand-pick picker) and wants to inspect a validator without leaving
 * the flow. Backed by the same useValidatorDetail hook the full-screen
 * Validator Detail page uses, but rendered as a compact overlay so the
 * in-progress selection isn't lost. Pass `elevated` when opening on top of
 * another sheet (the picker) so it stacks above it.
 */
interface ValidatorStatsSheetProps {
  /** Validator address to show, or null when nothing is selected. */
  address: string | null;
  open: boolean;
  onClose: () => void;
  /** Render above another open sheet (e.g. the validator picker). */
  elevated?: boolean;
}

export function ValidatorStatsSheet({
  address,
  open,
  onClose,
  elevated,
}: ValidatorStatsSheetProps) {
  // Only fetch while the sheet is open for a real address.
  const { validator, error } = useValidatorDetail(open ? address : null);

  return (
    <Sheet open={open} onClose={onClose} title="Validator" elevated={elevated}>
      {!validator && !error && (
        <LoadingIndicator message="Loading validator..." />
      )}

      {error && !validator && (
        <p className="text-sm text-danger">
          Couldn't load this validator — check your connection and try again.
        </p>
      )}

      {validator && <StatsBody validator={validator} />}
    </Sheet>
  );
}

function StatsBody({ validator }: { validator: ValidatorDetail }) {
  const sharePct = validator.currentEraNetworkPoints
    ? (validator.currentEraPoints / validator.currentEraNetworkPoints) * 100
    : 0;
  const display = validator.identity?.display;

  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="flex items-center gap-3">
        <AddressIcon address={validator.address} size={44} />
        <div className="flex-1 min-w-0">
          <AddressLabel
            address={validator.address}
            nameOverride={display ?? undefined}
            stacked
            className="text-base"
          />
        </div>
        {validator.blocked && (
          <span className="px-2 py-0.5 rounded-full bg-warning/10 text-warning text-xs font-medium flex-shrink-0">
            Blocked
          </span>
        )}
      </div>

      {/* Live metrics */}
      <div className="card grid grid-cols-2 gap-3">
        <Metric label="Commission" value={`${validator.commission.toFixed(2)}%`} />
        <Metric
          label="Total stake"
          value={
            validator.currentEraTotalStake
              ? formatBalance(validator.currentEraTotalStake, {
                  decimals: 0,
                  withSymbol: true,
                })
              : '—'
          }
        />
        <Metric
          label="Era points"
          value={validator.currentEraPoints.toLocaleString()}
        />
        <Metric label="Network share" value={`${sharePct.toFixed(2)}%`} />
        <Metric
          label="Self-bonded"
          value={
            validator.currentEraOwnStake
              ? formatBalance(validator.currentEraOwnStake, {
                  decimals: 0,
                  withSymbol: true,
                })
              : '—'
          }
        />
        <Metric
          label="Backers"
          value={
            validator.currentBackers.length
              ? validator.currentBackers.length.toLocaleString()
              : '—'
          }
        />
      </div>

      {/* Identity links, when present */}
      {validator.identity &&
        (validator.identity.web ||
          validator.identity.twitter ||
          validator.identity.email) && (
          <div className="card space-y-1.5">
            {validator.identity.web && (
              <IdentityRow label="Web" value={validator.identity.web} />
            )}
            {validator.identity.twitter && (
              <IdentityRow label="Twitter" value={validator.identity.twitter} />
            )}
            {validator.identity.email && (
              <IdentityRow label="Email" value={validator.identity.email} />
            )}
          </div>
        )}

      {/* Points history */}
      {validator.pointsHistory.length > 0 && (
        <div className="card space-y-2">
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Points per era · last {validator.pointsHistory.length} eras
          </p>
          <SparkBarChart
            data={validator.pointsHistory}
            height={56}
            barClassName="fill-ink-300"
            ariaLabel={`Points-per-era history, ${validator.pointsHistory.length} eras`}
          />
          {validator.historicalSnapshot?.relativePerformance != null && (
            <p className="text-xs text-ink-400">
              Relative performance:{' '}
              <span className="text-ink-200">
                {(
                  validator.historicalSnapshot.relativePerformance * 100
                ).toFixed(0)}
                % of network avg
              </span>{' '}
              (as of{' '}
              {new Date(validator.historicalSnapshot.timestamp)
                .toISOString()
                .slice(0, 10)}
              )
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-ink-400 font-medium mb-0.5">
        {label}
      </p>
      <p className="font-mono text-sm text-ink-100 numeric">{value}</p>
    </div>
  );
}

function IdentityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-ink-400 w-16 flex-shrink-0">{label}</span>
      <span className="text-ink-200 break-all min-w-0">{value}</span>
    </div>
  );
}
