import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, X as XIcon } from 'lucide-react';
import { TopBar } from '@/components/layout';
import { AddressIcon, LoadingIndicator } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { useMyGovernance, type MyDemocracyVoting } from '@/hooks';
import { displayName, useIdentity } from '@/governance';
import { formatBalance } from '@/utils';
import { useConnectionStore } from '@/store';
import {
  DelegateSheet,
  RemoveVoteSheet,
  UndelegateSheet,
  UnlockSheet,
} from '../Democracy';

/**
 * My Governance.
 *
 * `/governance/me`. Pulls account-specific state rather than chain-wide
 * queries. Shows the active account's commitments across democracy,
 * council elections, and tip endorsements.
 *
 * All sections are independent — a failure in one (per-branch flags
 * from useMyGovernance) renders an honest diagnostic on just that
 * card, not the whole screen. Surface the underlying error message on
 * the error UI (mobile has no easy console).
 */
export function MyGovernance() {
  const activeAddress = useAccountsStore((s) => s.activeAddress);
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAccount = useMemo(
    () => accounts.find((a) => a.address === activeAddress) ?? null,
    [accounts, activeAddress]
  );
  const my = useMyGovernance(activeAddress);

  return (
    <>
      <TopBar title="My governance" showBack />
      <div className="px-5 py-4 space-y-4 max-w-md mx-auto pb-8">
        {!activeAddress ? (
          <div className="card">
            <p className="text-sm text-ink-100 font-medium">No active account</p>
            <p className="mt-1 text-sm text-ink-400">
              Select an account to see your governance commitments.
            </p>
          </div>
        ) : (
          <>
            <ActiveAccountCard
              address={activeAddress}
              localName={activeAccount?.name}
            />

            {my.isLoading ? (
              <LoadingIndicator message="Loading your governance state..." />
            ) : (
              <>
                <DemocracySection
                  voting={my.voting}
                  failed={my.votingFailed}
                  diagnostic={diagnosticFor(my.diagnostic, 'voting:')}
                />
                <CouncilSection
                  vote={my.councilVote}
                  failed={my.councilFailed}
                  diagnostic={diagnosticFor(my.diagnostic, 'council:')}
                />
                <TipsSection
                  endorsements={my.tipEndorsements}
                  failed={my.tipsFailed}
                  diagnostic={diagnosticFor(my.diagnostic, 'tips:')}
                />
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function ActiveAccountCard({
  address,
  localName,
}: {
  address: string;
  localName?: string;
}) {
  const { identity } = useIdentity(address);
  const name = displayName(identity, address);
  return (
    <div className="card flex items-center gap-3">
      <AddressIcon address={address} size={36} copyOnTap={false} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-xs text-ink-400">Showing for</p>
        <p className="text-sm text-ink-100 truncate">
          {localName || name.primary}
        </p>
        {name.secondary && (
          <p className="text-xs text-ink-400 font-mono truncate">
            {name.secondary}
          </p>
        )}
      </div>
    </div>
  );
}

function DemocracySection({
  voting,
  failed,
  diagnostic,
}: {
  voting: MyDemocracyVoting;
  failed: boolean;
  diagnostic: string | null;
}) {
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [undelegateOpen, setUndelegateOpen] = useState(false);
  const [removeVoteFor, setRemoveVoteFor] = useState<{
    refIndex: number;
    balance: import('@polkadot/util').BN | null;
  } | null>(null);

  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base text-ink-100">Democracy</h2>
        <Link
          to="/governance/democracy"
          className="text-xs text-xx-500 active:text-xx-400 inline-flex items-center gap-0.5"
        >
          View all
          <ExternalLink size={11} strokeWidth={1.75} />
        </Link>
      </div>

      {failed && (
        <FailedDiagnostic
          label="Couldn't load your democracy state"
          diagnostic={diagnostic}
        />
      )}

      {!failed && voting.kind === 'none' && (
        <>
          <p className="text-sm text-ink-400">
            You haven't voted on any active referenda, and you're not
            delegating. When you vote on a referendum the entry shows
            here with its conviction and lock end.
          </p>
          <button
            onClick={() => setDelegateOpen(true)}
            className="text-xs text-xx-500 active:text-xx-400 font-medium"
          >
            Delegate vote power
          </button>
        </>
      )}

      {!failed && voting.kind === 'direct' && (
        <>
          {voting.votes.length === 0 ? (
            <p className="text-sm text-ink-400">
              You haven't voted on any active referenda yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {voting.votes.map((v) => (
                <li
                  key={v.refIndex}
                  className="border-b border-ink-800/60 last:border-0 pb-2 last:pb-0"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      to={`/governance/democracy/${v.refIndex}`}
                      className="text-sm text-ink-100 active:text-xx-500"
                    >
                      Referendum #{v.refIndex}
                    </Link>
                    {v.aye != null && (
                      <span
                        className={
                          v.aye
                            ? 'text-xs text-xx-500 font-medium'
                            : 'text-xs text-warning font-medium'
                        }
                      >
                        {v.aye ? 'Aye' : 'Nay'}
                      </span>
                    )}
                  </div>
                  {v.balance && v.conviction && (
                    <p className="text-xs text-ink-400 mt-0.5">
                      <span className="font-mono text-ink-300">
                        {formatBalance(v.balance, {
                          decimals: 4,
                          trim: true,
                          grouping: true,
                        })}{' '}
                        XX
                      </span>{' '}
                      · {v.conviction}
                    </p>
                  )}
                  <button
                    onClick={() =>
                      setRemoveVoteFor({
                        refIndex: v.refIndex,
                        balance: v.balance,
                      })
                    }
                    className="mt-1 inline-flex items-center gap-1 text-xs text-ink-400 active:text-danger font-medium"
                  >
                    <XIcon size={10} strokeWidth={2.5} />
                    Remove vote
                  </button>
                </li>
              ))}
            </ul>
          )}
          {voting.priorLock && (
            <PriorLockRow
              unlockAt={voting.priorLock.unlockAt}
              amount={voting.priorLock.amount}
            />
          )}
        </>
      )}

      {!failed && voting.kind === 'delegating' && (
        <>
          <p className="text-sm text-ink-100">
            Delegating to{' '}
            <span className="font-mono text-ink-200">
              {shortenAddress(voting.target)}
            </span>
          </p>
          <p className="text-xs text-ink-400">
            <span className="font-mono text-ink-300">
              {formatBalance(voting.balance, {
                decimals: 4,
                trim: true,
                grouping: true,
              })}{' '}
              XX
            </span>{' '}
            · {voting.conviction}
          </p>
          {voting.priorLock && (
            <PriorLockRow
              unlockAt={voting.priorLock.unlockAt}
              amount={voting.priorLock.amount}
            />
          )}
          <button
            onClick={() => setUndelegateOpen(true)}
            className="text-xs text-ink-400 active:text-danger font-medium"
          >
            Stop delegating
          </button>
        </>
      )}

      <DelegateSheet
        open={delegateOpen}
        onClose={() => setDelegateOpen(false)}
      />
      {voting.kind === 'delegating' && (
        <UndelegateSheet
          open={undelegateOpen}
          onClose={() => setUndelegateOpen(false)}
          currentTarget={voting.target}
        />
      )}
      {removeVoteFor && (
        <RemoveVoteSheet
          open={!!removeVoteFor}
          onClose={() => setRemoveVoteFor(null)}
          refIndex={removeVoteFor.refIndex}
          lockedAmount={removeVoteFor.balance}
        />
      )}
    </section>
  );
}

function PriorLockRow({
  unlockAt,
  amount,
}: {
  unlockAt: number;
  amount: import('@polkadot/util').BN;
}) {
  const blockNumber = useConnectionStore((s) => s.blockNumber);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const releasable = blockNumber != null && blockNumber >= unlockAt;

  return (
    <>
      <p className="text-xs text-ink-400">
        Prior lock:{' '}
        <span className="font-mono text-ink-300">
          {formatBalance(amount, {
            decimals: 4,
            trim: true,
            grouping: true,
          })}{' '}
          XX
        </span>{' '}
        {releasable ? (
          <span className="text-xx-500 font-medium">ready to release</span>
        ) : (
          <>until block #{unlockAt.toLocaleString()}</>
        )}
      </p>
      {releasable && (
        <button
          onClick={() => setUnlockOpen(true)}
          className="mt-1 text-xs text-xx-500 active:text-xx-400 font-medium"
        >
          Release lock
        </button>
      )}
      {releasable && (
        <UnlockSheet
          open={unlockOpen}
          onClose={() => setUnlockOpen(false)}
          amount={amount}
          unlockAt={unlockAt}
        />
      )}
    </>
  );
}

function CouncilSection({
  vote,
  failed,
  diagnostic,
}: {
  vote: ReturnType<typeof useMyGovernance>['councilVote'];
  failed: boolean;
  diagnostic: string | null;
}) {
  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base text-ink-100">Council</h2>
        <Link
          to="/governance/council"
          className="text-xs text-xx-500 active:text-xx-400 inline-flex items-center gap-0.5"
        >
          View all
          <ExternalLink size={11} strokeWidth={1.75} />
        </Link>
      </div>

      {failed && (
        <FailedDiagnostic
          label="Couldn't load your council vote"
          diagnostic={diagnostic}
        />
      )}

      {!failed && !vote && (
        <p className="text-sm text-ink-400">
          You haven't cast a council vote. Up to 16 candidates can be
          backed in a single vote.
        </p>
      )}

      {!failed && vote && (
        <>
          <p className="text-sm text-ink-100">
            Backing{' '}
            <span className="font-medium">{vote.votes.length}</span>{' '}
            candidate{vote.votes.length === 1 ? '' : 's'} with{' '}
            <span className="font-mono text-ink-200">
              {formatBalance(vote.stake, {
                decimals: 4,
                trim: true,
                grouping: true,
              })}{' '}
              XX
            </span>
          </p>
          {!vote.deposit.isZero() && (
            <p className="text-xs text-ink-400">
              Voting bond:{' '}
              <span className="font-mono text-ink-300">
                {formatBalance(vote.deposit, {
                  decimals: 4,
                  trim: true,
                  grouping: true,
                })}{' '}
                XX
              </span>
            </p>
          )}
          {vote.votes.length > 0 && (
            <ul className="space-y-1">
              {vote.votes.map((v) => (
                <li
                  key={v}
                  className="text-xs text-ink-400 font-mono truncate"
                >
                  {shortenAddress(v)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function TipsSection({
  endorsements,
  failed,
  diagnostic,
}: {
  endorsements: ReturnType<typeof useMyGovernance>['tipEndorsements'];
  failed: boolean;
  diagnostic: string | null;
}) {
  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base text-ink-100">Tip endorsements</h2>
        <Link
          to="/governance/treasury"
          className="text-xs text-xx-500 active:text-xx-400 inline-flex items-center gap-0.5"
        >
          View all
          <ExternalLink size={11} strokeWidth={1.75} />
        </Link>
      </div>

      {failed && (
        <FailedDiagnostic
          label="Couldn't load your tip endorsements"
          diagnostic={diagnostic}
        />
      )}

      {!failed && endorsements.length === 0 && (
        <p className="text-sm text-ink-400">
          You haven't endorsed any active tips. Endorsing requires being
          a council member.
        </p>
      )}

      {!failed && endorsements.length > 0 && (
        <ul className="space-y-2">
          {endorsements.map((e) => (
            <li
              key={e.hash}
              className="border-b border-ink-800/60 last:border-0 pb-2 last:pb-0"
            >
              <p className="text-xs text-ink-400 font-mono truncate">
                {e.hash}
              </p>
              <p className="text-sm text-ink-100 mt-0.5">
                Tipping{' '}
                <span className="font-mono text-ink-200">
                  {shortenAddress(e.who)}
                </span>
              </p>
              <p className="text-xs text-ink-400 mt-0.5">
                Your tip:{' '}
                <span className="font-mono text-ink-300">
                  {formatBalance(e.tipAmount, {
                    decimals: 4,
                    trim: true,
                    grouping: true,
                  })}{' '}
                  XX
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FailedDiagnostic({
  label,
  diagnostic,
}: {
  label: string;
  diagnostic: string | null;
}) {
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-2.5">
      <p className="text-xs text-warning">{label}</p>
      {diagnostic && (
        <p className="mt-1 text-xs text-ink-400 font-mono break-all">
          {diagnostic}
        </p>
      )}
    </div>
  );
}

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 5)}…${addr.slice(-4)}`;
}

/**
 * Pull a section-specific diagnostic out of the aggregate string. The
 * useMyGovernance hook concatenates branch diagnostics as
 * `voting: msg · council: msg · tips: msg`; this picks the slice that
 * belongs to one section so the warning card shows only its piece.
 */
function diagnosticFor(
  aggregate: string | null,
  prefix: string
): string | null {
  if (!aggregate) return null;
  const parts = aggregate.split(' · ');
  for (const part of parts) {
    if (part.startsWith(prefix)) return part.slice(prefix.length).trim();
  }
  return null;
}
