import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Coins, Settings2 } from 'lucide-react';
import { useAccountsStore } from '@/store';
import { BN } from '@polkadot/util';
import {
  useStakingPosition,
  useStakingRoles,
  useRewardsHistory,
  type StakingPosition,
  type UnlockingChunk,
} from '@/hooks';
import type { AccountRoles } from '@/api';
import { formatBalance } from '@/utils';
import { AddressLabel, LoadingIndicator, StakingStatusBadge } from '@/components/ui';
import { ManageStakeSheet } from './ManageStakeSheet';
import { RecentAlertsBanner } from './RecentAlertsBanner';

/**
 * Staking section — My Nominations sub-view (slice 1).
 *
 * For the active account, shows whether it's nominating and the honest
 * per-target status of each nomination (active / not-earning /
 * inactive), plus the bonded ledger. Read-only — bonding and
 * nominating are Phase 3.
 *
 * Account-scoped to the active wallet account. useStakingPosition is
 * account-agnostic, so the multisig detail screen can reuse it later
 * by passing a multisig address.
 */
export function MyNominations() {
  const { accounts, activeAddress } = useAccountsStore();
  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? accounts[0],
    [accounts, activeAddress]
  );

  const { position, error } = useStakingPosition(
    activeAccount?.address ?? null
  );
  const { roles } = useStakingRoles(activeAccount?.address ?? null);

  if (!activeAccount) {
    // Route guard should prevent this, but be defensive.
    return null;
  }

  return (
    <div className="px-5 py-4 space-y-5">
      {/* Account + role context */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-display font-medium text-base truncate">
            {activeAccount.name}
          </p>
          <p className="font-mono text-xs text-ink-400 truncate">
            {activeAccount.address.slice(0, 10)}…
            {activeAccount.address.slice(-6)}
          </p>
        </div>
        {roles && <RoleTags roles={roles} />}
      </div>

      {/* Slash alerts — rendered at top so users see them before they
          scroll to nomination state. Hidden when no active alerts. */}
      <RecentAlertsBanner
        activeEra={position?.activeEra ?? null}
        forAddress={activeAccount.address}
      />

      {!position && !error && (
        <>
          <LoadingIndicator message="Loading your nominations..." />
          <StakingSkeleton />
        </>
      )}

      {error && (
        <div className="card">
          <p className="text-sm text-danger">
            Couldn't load staking data — check your connection and try
            again.
          </p>
        </div>
      )}

      {position && !error && (
        <>
          {position.isNominating ? (
            <NominatingView position={position} />
          ) : (
            <EmptyState isBonded={position.ledger !== null} />
          )}
          <RewardsSummaryCard address={activeAccount.address} />
        </>
      )}
    </div>
  );
}

/**
 * Rewards summary — shown below the nominating view (or empty state)
 * whenever the active account has any reward history in the last 90
 * eras. Taps through to the full Rewards screen.
 */
function RewardsSummaryCard({ address }: { address: string }) {
  const { history } = useRewardsHistory(address);
  // Hide until loaded, and hide when there's nothing to show — the
  // empty state on the dedicated Rewards screen handles the no-history
  // case there.
  if (!history || history.eraCount === 0) return null;
  return (
    <Link
      to="/staking/rewards"
      className="card block active:bg-ink-800/40 transition-colors"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-ink-400 font-medium">
          Rewards · last 90 eras
        </span>
        <span className="text-xs text-xx-500">View all →</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium mb-0.5">
            Total earned
          </p>
          <p className="font-mono text-sm text-ink-100 numeric">
            {formatBalance(history.totalOverWindow, {
              decimals: 4,
              withSymbol: true,
            })}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-ink-400 font-medium mb-0.5">
            Eras with rewards
          </p>
          <p className="font-mono text-sm text-ink-100 numeric">
            {history.eraCount}
          </p>
        </div>
      </div>
    </Link>
  );
}

/**
 * Small role pills next to the account name. Driven by the indexer's
 * account-table role flags (currently-is, not has-ever-been).
 */
function RoleTags({ roles }: { roles: AccountRoles }) {
  const tags: string[] = [];
  if (roles.validator) tags.push('Validator');
  if (roles.council) tags.push('Council');
  if (roles.techcommit) tags.push('Tech Committee');
  if (roles.special) tags.push(roles.special);
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 justify-end flex-shrink-0">
      {tags.map((tag) => (
        <span
          key={tag}
          className="px-2 py-0.5 rounded-full bg-xx-500/10 text-xx-500 text-xs font-medium"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function NominatingView({ position }: { position: StakingPosition }) {
  const {
    ledger,
    targets,
    targetStatus,
    submittedInEra,
    suppressed,
    activeEra,
  } = position;
  const [manageOpen, setManageOpen] = useState(false);
  return (
    <>
      {/* Bonded summary */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-ink-400 font-medium">
            Bonded
          </span>
          {submittedInEra !== null && (
            <span className="text-xs text-ink-400">
              Nominating since era {submittedInEra}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium mb-0.5">
              Total
            </p>
            <p className="font-mono text-sm text-ink-100 numeric">
              {ledger
                ? formatBalance(ledger.total, {
                    decimals: 4,
                    withSymbol: true,
                  })
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-ink-400 font-medium mb-0.5">
              Active
            </p>
            <p className="font-mono text-sm text-ink-100 numeric">
              {ledger
                ? formatBalance(ledger.active, {
                    decimals: 4,
                    withSymbol: true,
                  })
                : '—'}
            </p>
          </div>
        </div>
        {suppressed && (
          <p className="text-sm text-warning">
            This nomination is suppressed on chain — it won't be considered
            in elections until it's resubmitted.
          </p>
        )}
        {ledger && ledger.unlocking.length > 0 && (
          <UnlockingSection
            unlocking={ledger.unlocking}
            activeEra={activeEra}
          />
        )}
      </div>

      {/* Manage stake */}
      <button
        onClick={() => setManageOpen(true)}
        className="card w-full flex items-center gap-3 active:bg-ink-800/40 transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-full bg-xx-500/10 text-xx-500 flex items-center justify-center flex-shrink-0">
          <Settings2 size={18} strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-medium text-sm text-ink-100">
            Manage stake
          </p>
          <p className="text-xs text-ink-400 mt-0.5">
            Add to stake, change validators, or stop nominating.
          </p>
        </div>
        <ChevronRight
          size={16}
          strokeWidth={1.75}
          className="text-ink-500 flex-shrink-0"
        />
      </button>

      {/* Nomination targets */}
      <div className="card">
        <h3 className="font-display font-medium text-sm text-ink-200 mb-1">
          Nominating {targets.length} validator
          {targets.length === 1 ? '' : 's'}
        </h3>
        {activeEra !== null ? (
          <p className="text-xs text-ink-400 mb-3">
            Status shown for era {activeEra}.
          </p>
        ) : (
          <p className="text-xs text-warning mb-3">
            Couldn't read the current era — per-validator status is
            unavailable.
          </p>
        )}
        <ul>
          {targets.map((target) => {
            const status = targetStatus[target];
            return (
              <li
                key={target}
                className="flex items-center justify-between gap-3 py-2.5 border-b border-ink-800/60 last:border-0"
              >
                <AddressLabel address={target} className="text-sm" />
                {status && <StakingStatusBadge status={status} />}
              </li>
            );
          })}
        </ul>
      </div>

      <ManageStakeSheet open={manageOpen} onClose={() => setManageOpen(false)} />
    </>
  );
}

/**
 * Per-chunk unlocking detail. Shown inside the Bonded summary card when
 * the ledger has any unlocking chunks. Matured chunks (era ≤ activeEra)
 * surface a Withdraw CTA at the top; in-progress chunks show a per-chunk
 * countdown. At 24h/era on xx network, eras-remaining ≈ days-remaining.
 */
function UnlockingSection({
  unlocking,
  activeEra,
}: {
  unlocking: UnlockingChunk[];
  activeEra: number | null;
}) {
  const matured = activeEra !== null
    ? unlocking.filter((c) => c.era <= activeEra)
    : [];
  const pending = activeEra !== null
    ? unlocking.filter((c) => c.era > activeEra)
    : unlocking;
  const maturedTotal = matured.reduce(
    (acc, c) => acc.add(c.value),
    new BN(0)
  );
  return (
    <div className="pt-3 border-t border-ink-800/60 space-y-2">
      <p className="text-xs uppercase tracking-wider text-ink-400 font-medium">
        Unbonding
      </p>
      {matured.length > 0 && (
        <Link
          to="/staking/withdraw"
          className="flex items-center justify-between gap-3 -mx-2 px-2 py-2 rounded-xl bg-xx-500/10 active:bg-xx-500/15 transition-colors"
        >
          <div>
            <p className="text-sm text-ink-100">
              Ready to withdraw
            </p>
            <p className="text-xs text-ink-400">
              {matured.length} chunk{matured.length === 1 ? '' : 's'} matured
            </p>
          </div>
          <span className="font-mono text-sm text-xx-500 numeric flex-shrink-0">
            +{formatBalance(maturedTotal, { decimals: 4, withSymbol: true })} →
          </span>
        </Link>
      )}
      {pending.length > 0 && (
        <ul className="space-y-1">
          {pending.map((c, idx) => {
            const erasLeft = activeEra !== null ? c.era - activeEra : null;
            return (
              <li
                key={`${c.era}-${idx}`}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="text-ink-400">
                  Available in{' '}
                  {erasLeft !== null
                    ? `${erasLeft} day${erasLeft === 1 ? '' : 's'}`
                    : `era ${c.era}`}
                </span>
                <span className="font-mono text-ink-200 numeric">
                  {formatBalance(c.value, { decimals: 4, withSymbol: true })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ isBonded }: { isBonded: boolean }) {
  if (isBonded) {
    // Bonded but not nominating — chilled, freshly bonded, or validating-only.
    // Phase 3 slice 2 will surface a "Resume nominating" action here.
    return (
      <div className="card flex flex-col items-center text-center gap-3 py-8">
        <div className="w-14 h-14 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center">
          <Coins size={24} strokeWidth={1.5} className="text-ink-400" />
        </div>
        <div className="space-y-1 max-w-xs">
          <p className="font-display font-medium text-sm text-ink-100">
            Bonded, not nominating
          </p>
          <p className="text-sm text-ink-400">
            This account is bonded but isn't nominating any validators.
            Nominate-from-bonded arrives later in Phase 3.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="card flex flex-col items-center text-center gap-4 py-8">
      <div className="w-14 h-14 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center">
        <Coins size={24} strokeWidth={1.5} className="text-ink-400" />
      </div>
      <div className="space-y-1 max-w-xs">
        <p className="font-display font-medium text-sm text-ink-100">
          Not nominating
        </p>
        <p className="text-sm text-ink-400">
          Earn staking rewards by bonding XX and nominating validators.
          xx unbonding takes 28 days.
        </p>
      </div>
      <Link
        to="/staking/start"
        className="px-5 py-2.5 rounded-full bg-xx-500 text-ink-950 text-sm font-medium active:opacity-80 transition-opacity"
      >
        Start staking
      </Link>
      <Link
        to="/staking/validate"
        className="text-xs text-ink-400 active:text-ink-200 transition-colors"
      >
        Running a validator? Set up here →
      </Link>
    </div>
  );
}

function StakingSkeleton() {
  return (
    <div className="space-y-5">
      <div className="card h-24 animate-pulse-subtle" />
      <div className="card space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="h-3 rounded bg-ink-700/50 animate-pulse-subtle w-1/3" />
            <div className="h-5 rounded-full bg-ink-700/50 animate-pulse-subtle w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
