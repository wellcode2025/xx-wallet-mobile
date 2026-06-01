import { useParams } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { useValidatorDetail, type ValidatorDetail as ValidatorDetailType } from '@/hooks';
import { formatBalance } from '@/utils';
import { TopBar } from '@/components/layout';
import { AddressIcon, AddressLabel, LoadingIndicator, SparkBarChart } from '@/components/ui';

/**
 * Validator Detail.
 *
 * Tap a row in the ValidatorList → drill into a single
 * validator. Live data from chain for anything that would drive a
 * staking action (commission, stake, points, blocked, cmix_id,
 * current backers). Historical data from the indexer (location,
 * relative_performance, points-over-eras chart), clearly framed as
 * "as of <date>" because validator_stats is frozen at era 1384.
 *
 * Sibling at the route level — not inside StakingLayout's segmented
 * control. Drill-down treatment: full-screen, back-button, no sub-tabs.
 */
export function ValidatorDetail() {
  const { address = '' } = useParams<{ address: string }>();
  const { validator, error } = useValidatorDetail(address);

  return (
    <>
      <TopBar title="Validator" showBack />
      <div className="px-5 py-4 space-y-4">
        {!validator && !error && (
          <>
            <LoadingIndicator message="Loading validator details..." />
            <ValidatorDetailSkeleton />
          </>
        )}

        {error && !validator && (
          <div className="card">
            <p className="text-sm text-danger">
              Couldn't load validator details — check your connection and try
              again.
            </p>
          </div>
        )}

        {validator && (
          <>
            <IdentityCard validator={validator} />
            <LiveStatusCard validator={validator} />
            {validator.bondedTotal && <BondedCard validator={validator} />}
            {validator.currentBackers.length > 0 && (
              <CurrentBackersCard validator={validator} />
            )}
            {validator.historicalSnapshot && (
              <HistoricalSnapshotCard validator={validator} />
            )}
          </>
        )}
      </div>
    </>
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

function IdentityCard({ validator }: { validator: ValidatorDetailType }) {
  const display = validator.identity?.display;
  const hasDetails =
    validator.identity &&
    Boolean(
      validator.identity.legal ||
        validator.identity.web ||
        validator.identity.email ||
        validator.identity.twitter ||
        validator.identity.riot
    );
  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-3">
        <AddressIcon address={validator.address} size={48} />
        <div className="flex-1 min-w-0">
          <AddressLabel
            address={validator.address}
            nameOverride={display ?? undefined}
            stacked
            className="text-base"
          />
        </div>
      </div>
      {validator.cmixId && (
        <div>
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium mb-0.5">
            cMix node id
          </p>
          <p className="font-mono text-xs text-ink-200 break-all">
            {validator.cmixId}
          </p>
        </div>
      )}
      {hasDetails && validator.identity && (
        <div className="space-y-1.5 pt-2 border-t border-ink-800/60">
          {validator.identity.legal && (
            <IdentityRow label="Legal" value={validator.identity.legal} />
          )}
          {validator.identity.web && (
            <IdentityRow label="Web" value={validator.identity.web} />
          )}
          {validator.identity.email && (
            <IdentityRow label="Email" value={validator.identity.email} />
          )}
          {validator.identity.twitter && (
            <IdentityRow label="Twitter" value={validator.identity.twitter} />
          )}
          {validator.identity.riot && (
            <IdentityRow label="Riot" value={validator.identity.riot} />
          )}
        </div>
      )}
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

function LiveStatusCard({ validator }: { validator: ValidatorDetailType }) {
  const sharePct = validator.currentEraNetworkPoints
    ? (validator.currentEraPoints / validator.currentEraNetworkPoints) * 100
    : 0;
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-ink-400 font-medium">
          Current era
          {validator.currentEra !== null && ` · ${validator.currentEra}`}
        </span>
        {validator.blocked && (
          <span className="px-2 py-0.5 rounded-full bg-warning/10 text-warning text-xs font-medium">
            Blocked
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Commission"
          value={`${validator.commission.toFixed(2)}%`}
        />
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
      </div>
    </div>
  );
}

function BondedCard({ validator }: { validator: ValidatorDetailType }) {
  return (
    <div className="card space-y-3">
      <span className="text-xs uppercase tracking-wider text-ink-400 font-medium">
        Bonded
      </span>
      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Total"
          value={
            validator.bondedTotal
              ? formatBalance(validator.bondedTotal, {
                  decimals: 4,
                  withSymbol: true,
                })
              : '—'
          }
        />
        <Metric
          label="Active"
          value={
            validator.bondedActive
              ? formatBalance(validator.bondedActive, {
                  decimals: 4,
                  withSymbol: true,
                })
              : '—'
          }
        />
      </div>
    </div>
  );
}

function CurrentBackersCard({ validator }: { validator: ValidatorDetailType }) {
  return (
    <div className="card">
      <h3 className="font-display font-medium text-sm text-ink-200 mb-1">
        Current backers ({validator.currentBackers.length})
      </h3>
      {validator.currentEra !== null && (
        <p className="text-xs text-ink-400 mb-3">
          In the rewarded set this era (era {validator.currentEra}).
        </p>
      )}
      <ul>
        {validator.currentBackers.map((b) => (
          <li
            key={b.address}
            className="flex items-center justify-between gap-3 py-2.5 border-b border-ink-800/60 last:border-0"
          >
            <AddressLabel address={b.address} className="text-sm min-w-0" />
            <span className="font-mono text-sm text-ink-200 numeric flex-shrink-0">
              {formatBalance(b.stake, { decimals: 0, withSymbol: true })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HistoricalSnapshotCard({
  validator,
}: {
  validator: ValidatorDetailType;
}) {
  const snap = validator.historicalSnapshot;
  if (!snap) return null;
  const asOf = new Date(snap.timestamp).toISOString().slice(0, 10);
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-ink-400 font-medium">
          Historical snapshot
        </span>
        <span className="text-xs text-warning">As of {asOf}</span>
      </div>
      {snap.location && (
        <div className="flex items-center gap-2">
          <MapPin size={14} className="text-ink-400 flex-shrink-0" />
          <p className="text-sm text-ink-200">
            {snap.location.city}, {snap.location.country}
            {snap.location.geoBin && (
              <span className="text-ink-400"> · {snap.location.geoBin}</span>
            )}
          </p>
        </div>
      )}
      {snap.relativePerformance !== null && (
        <Metric
          label="Relative performance"
          value={`${(snap.relativePerformance * 100).toFixed(1)}% of network avg`}
        />
      )}
      {validator.pointsHistory.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium mb-2">
            Points per era · last {validator.pointsHistory.length} eras
          </p>
          <SparkBarChart
            data={validator.pointsHistory}
            height={64}
            barClassName="fill-ink-300"
            ariaLabel={`Points-per-era history bar chart, ${validator.pointsHistory.length} eras`}
          />
        </div>
      )}
    </div>
  );
}

function ValidatorDetailSkeleton() {
  return (
    <>
      <div className="card h-20 animate-pulse-subtle" />
      <div className="card h-28 animate-pulse-subtle" />
      <div className="card h-20 animate-pulse-subtle" />
      <div className="card h-40 animate-pulse-subtle" />
    </>
  );
}
