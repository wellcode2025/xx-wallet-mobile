import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { TopBar } from '@/components/layout';
import { LoadingIndicator } from '@/components/ui';
import { useDemocracy, useMyGovernance } from '@/hooks';
import { useAccountsStore } from '@/store';
import { useConnectionStore } from '@/store';
import { blocksToHuman } from '@/governance';
import { formatBalance, shortenAddress } from '@/utils';
import { VoteSheet } from './VoteSheet';

/**
 * Phase 4b Slice 6 — Referendum detail screen.
 *
 * `/governance/democracy/:id`. Deferred from Slice 2 because the chain
 * had 0 active referenda then (still does as of this slice, but the
 * Vote button needs somewhere to live so the screen ships now).
 *
 * Anchor for the Vote button. Below the per-referendum data: tally,
 * threshold, end-block countdown, proposal hash. Above the Vote button:
 * a "you already voted" callout if useMyGovernance shows the active
 * account has a vote on this id.
 */

function parseId(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

export function ReferendumDetail() {
  const params = useParams<{ id: string }>();
  const id = parseId(params.id);
  const { ongoing, isLoading, error } = useDemocracy();
  const activeAddress = useAccountsStore((s) => s.activeAddress);
  const my = useMyGovernance(activeAddress);
  const blockNumber = useConnectionStore((s) => s.blockNumber);
  const [voteSheetOpen, setVoteSheetOpen] = useState(false);

  const referendum = useMemo(
    () => ongoing.find((r) => r.id === id) ?? null,
    [ongoing, id]
  );

  const myVoteOnThis = useMemo(() => {
    if (id == null) return null;
    if (my.voting.kind !== 'direct') return null;
    return my.voting.votes.find((v) => v.refIndex === id) ?? null;
  }, [my, id]);

  return (
    <>
      <TopBar
        title={id != null ? `Referendum #${id}` : 'Referendum'}
        showBack
      />
      <div className="px-5 py-4 space-y-4 max-w-md mx-auto pb-8">
        {id == null && (
          <div className="card">
            <p className="text-sm text-danger">
              That referendum id isn't valid.
            </p>
          </div>
        )}

        {id != null && isLoading && (
          <LoadingIndicator message="Loading referendum from chain..." />
        )}

        {id != null && error && !isLoading && (
          <div className="card">
            <p className="text-sm text-danger">
              Couldn't load referendum state — check your connection.
            </p>
            <p className="mt-2 text-xs text-ink-400 font-mono break-all">
              {error.message || String(error)}
            </p>
          </div>
        )}

        {id != null && !isLoading && !error && !referendum && (
          <div className="card">
            <p className="text-sm text-ink-100 font-medium">
              No active referendum with that id
            </p>
            <p className="mt-1 text-sm text-ink-400">
              Referendum #{id} isn't currently active. It may have been
              closed, cancelled, or never opened. Past referenda are
              available on the explorer.
            </p>
          </div>
        )}

        {id != null && referendum && (
          <>
            <div className="card space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs text-ink-400 font-mono">#{referendum.id}</p>
                <p className="text-xs text-ink-400">{referendum.threshold}</p>
              </div>

              {/* Tally */}
              <div className="space-y-2">
                <TallyBar
                  ayes={referendum.tally.ayes}
                  nays={referendum.tally.nays}
                />
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <TallyCell label="Ayes" amount={referendum.tally.ayes} highlight="aye" />
                  <TallyCell label="Nays" amount={referendum.tally.nays} highlight="nay" />
                  <TallyCell label="Turnout" amount={referendum.tally.turnout} />
                </div>
              </div>

              {/* End block + countdown */}
              <p className="text-xs text-ink-400">
                Ends in{' '}
                <span className="text-ink-200">
                  {blocksToHuman(blockNumber, referendum.end).label}
                </span>
                <span className="text-ink-400">
                  {' '}
                  (block #{referendum.end.toLocaleString()})
                </span>
              </p>
            </div>

            {referendum.proposalHash && (
              <div className="card space-y-2">
                <p className="text-xs text-ink-400">Proposal hash</p>
                <p className="font-mono text-xs text-ink-200 break-all">
                  {referendum.proposalHash}
                </p>
              </div>
            )}

            {/* Vote section */}
            {myVoteOnThis ? (
              <div className="card space-y-2">
                <p className="text-xs text-ink-400">Your vote</p>
                <div className="flex items-baseline gap-2">
                  {myVoteOnThis.aye === true && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-xx-500/10 text-xx-500 border border-xx-500/30">
                      <Check size={11} strokeWidth={2.5} />
                      Aye
                    </span>
                  )}
                  {myVoteOnThis.aye === false && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-ink-800 text-warning border border-ink-700/50">
                      <X size={11} strokeWidth={2.5} />
                      Nay
                    </span>
                  )}
                  {myVoteOnThis.aye === null && (
                    <span className="text-xs text-ink-400">Split vote</span>
                  )}
                  {myVoteOnThis.balance && (
                    <span className="font-mono text-xs text-ink-200">
                      {formatBalance(myVoteOnThis.balance, {
                        decimals: 4,
                        trim: true,
                        grouping: true,
                      })}{' '}
                      XX
                    </span>
                  )}
                  {myVoteOnThis.conviction && (
                    <span className="text-xs text-ink-400">
                      · {myVoteOnThis.conviction}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setVoteSheetOpen(true)}
                  className="text-xs text-xx-500 active:text-xx-400 font-medium"
                >
                  Change vote
                </button>
              </div>
            ) : (
              <button
                onClick={() => setVoteSheetOpen(true)}
                disabled={!activeAddress}
                className="w-full py-3 rounded-2xl bg-xx-500 text-ink-950 font-display font-medium text-base active:bg-xx-600 disabled:opacity-40 disabled:active:bg-xx-500 transition-colors"
              >
                Vote
              </button>
            )}

            {activeAddress && (
              <p className="text-xs text-ink-400 text-center">
                Voting as {shortenAddress(activeAddress)}
              </p>
            )}
          </>
        )}
      </div>

      {referendum && activeAddress && (
        <VoteSheet
          open={voteSheetOpen}
          onClose={() => setVoteSheetOpen(false)}
          refIndex={referendum.id}
          initialAye={myVoteOnThis?.aye ?? true}
        />
      )}
    </>
  );
}

function TallyBar({
  ayes,
  nays,
}: {
  ayes: import('@polkadot/util').BN;
  nays: import('@polkadot/util').BN;
}) {
  // Compute aye fraction defensively — avoid divide-by-zero.
  const total = ayes.add(nays);
  const ayePct = total.isZero()
    ? 50
    : Math.round((ayes.muln(100).div(total)).toNumber());
  return (
    <div className="h-2 rounded-full bg-ink-800 overflow-hidden flex">
      <div
        className="h-full bg-xx-500/70"
        style={{ width: `${ayePct}%` }}
      />
      <div
        className="h-full bg-warning/50"
        style={{ width: `${100 - ayePct}%` }}
      />
    </div>
  );
}

function TallyCell({
  label,
  amount,
  highlight,
}: {
  label: string;
  amount: import('@polkadot/util').BN;
  highlight?: 'aye' | 'nay';
}) {
  const labelCls =
    highlight === 'aye'
      ? 'text-xx-500'
      : highlight === 'nay'
      ? 'text-warning'
      : 'text-ink-400';
  return (
    <div>
      <p className={labelCls}>{label}</p>
      <p className="font-mono text-ink-200 numeric truncate">
        {formatBalance(amount, {
          decimals: 0,
          trim: true,
          grouping: true,
        })}
        <span className="text-ink-400"> XX</span>
      </p>
    </div>
  );
}
