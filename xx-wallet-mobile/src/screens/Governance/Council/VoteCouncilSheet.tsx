import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { BN } from '@polkadot/util';
import { Check, Trash2 } from 'lucide-react';
import { Sheet, TxFooter, AddressIcon, AddressLabel } from '@/components/ui';
import { useAccountsStore } from '@/store';
import { xxApi } from '@/api';
import {
  useBalance,
  councilVoteBond,
  additionalBond,
  validateCouncilVote,
  MAX_COUNCIL_VOTES,
} from '@/hooks';
import { formatBalance } from '@/utils';
import { parseAmount } from '../Democracy/VoteSheet';
import type { UseCouncilResult } from './CouncilOverview';

/**
 * Vote for council members — `elections.vote(votes, value)`.
 *
 * Spiked live 2026-07-08: pick up to 16 of the current members / runners-up /
 * candidates; `value` is LOCKED (not spent) from free balance while the vote
 * stands, plus a RESERVED bond of votingBondBase + votingBondFactor × votes
 * (20.064 + 0.032·n XX on mainnet). Re-voting replaces the previous vote and
 * only tops the bond up. `elections.removeVoter()` (the trash action below,
 * shown when the signer already votes) releases the lock + refunds the bond.
 *
 * Votes carry no conviction — stake weight only — and the election re-runs
 * every termDuration (7 days on xx), so a standing vote keeps counting each
 * cycle until removed.
 */

interface VoteCouncilSheetProps {
  open: boolean;
  onClose: () => void;
  council: UseCouncilResult;
}

/** The signer's existing vote, read from elections.voting(signer). */
interface ExistingVote {
  votes: string[];
  stake: BN;
  deposit: BN;
}

export function VoteCouncilSheet({ open, onClose, council }: VoteCouncilSheetProps) {
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAddress = useAccountsStore((s) => s.activeAddress);
  const [signerAddress, setSignerAddress] = useState<string>(
    () => activeAddress ?? accounts[0]?.address ?? ''
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stakeStr, setStakeStr] = useState('');
  const [mode, setMode] = useState<'vote' | 'remove'>('vote');

  // Bond constants + the signer's existing vote, read once per open/signer.
  const [bondBase, setBondBase] = useState<BN | null>(null);
  const [bondFactor, setBondFactor] = useState<BN | null>(null);
  const [minStake, setMinStake] = useState<BN | null>(null);
  const [existing, setExisting] = useState<ExistingVote | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!signerAddress || !accounts.some((a) => a.address === signerAddress)) {
      setSignerAddress(activeAddress ?? accounts[0]?.address ?? '');
    }
  }, [open, activeAddress, accounts, signerAddress]);

  useEffect(() => {
    if (open) return;
    setSelected(new Set());
    setStakeStr('');
    setMode('vote');
  }, [open]);

  useEffect(() => {
    if (!open || !signerAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const api = await xxApi.getApi();
        if (cancelled) return;
        const consts: any = (api.consts as any).elections ?? {};
        setBondBase(consts.votingBondBase ? consts.votingBondBase.toBn() : null);
        setBondFactor(consts.votingBondFactor ? consts.votingBondFactor.toBn() : null);
        // The pallet rejects stake <= existential deposit (elections.LowBalance,
        // hit live 2026-07-08) — read the real ED, never assume it.
        const ed = (api.consts as any).balances?.existentialDeposit;
        setMinStake(ed ? ed.toBn() : null);
        // Voting is a struct — named-field access per house rule (enums are
        // the toJSON case). toBn() keeps u128 precision.
        const voting: any = await (api.query as any).elections.voting(signerAddress);
        if (cancelled) return;
        const votes = (voting?.votes?.toJSON?.() ?? []) as string[];
        if (votes.length > 0) {
          setExisting({
            votes,
            stake: voting.stake?.toBn ? voting.stake.toBn() : new BN(0),
            deposit: voting.deposit?.toBn ? voting.deposit.toBn() : new BN(0),
          });
        } else {
          setExisting(null);
        }
      } catch {
        if (!cancelled) {
          setExisting(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, signerAddress]);

  const { balance } = useBalance(signerAddress || null);
  const available = useMemo(() => balance?.transferable ?? new BN(0), [balance]);

  // Everyone votable: sitting members, runners-up, and open candidates.
  const votable = useMemo(() => {
    const seen = new Set<string>();
    const out: { address: string; role: string }[] = [];
    for (const [list, role] of [
      [council.members, 'Member'],
      [council.runnersUp, 'Runner-up'],
      [council.candidates, 'Candidate'],
    ] as const) {
      for (const c of list) {
        if (seen.has(c.address)) continue;
        seen.add(c.address);
        out.push({ address: c.address, role });
      }
    }
    return out;
  }, [council.members, council.runnersUp, council.candidates]);

  const toggle = (address: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else if (next.size < MAX_COUNCIL_VOTES) next.add(address);
      return next;
    });

  const stakeBn = useMemo(() => parseAmount(stakeStr), [stakeStr]);
  const newBond = useMemo(
    () =>
      bondBase && bondFactor ? councilVoteBond(bondBase, bondFactor, selected.size) : null,
    [bondBase, bondFactor, selected.size]
  );
  const bondTopUp = useMemo(
    () => (newBond ? additionalBond(newBond, existing?.deposit ?? null) : null),
    [newBond, existing]
  );

  const validation = useMemo(
    () =>
      validateCouncilVote({
        selectedCount: selected.size,
        stake: stakeBn,
        available,
        newBond: newBond ?? new BN(0),
        existingDeposit: existing?.deposit ?? null,
        minStake,
      }),
    [selected.size, stakeBn, available, newBond, existing, minStake]
  );

  const fmt = (v: BN) => `${formatBalance(v, { decimals: 4, trim: true, grouping: true })} XX`;

  return (
    <Sheet open={open} onClose={onClose} title="Vote for council">
      <div className="space-y-4">
        {existing && (
          <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3 space-y-1">
            <p className="text-xs text-ink-300">
              This account already votes for {existing.votes.length}{' '}
              {existing.votes.length === 1 ? 'candidate' : 'candidates'} with{' '}
              <span className="font-mono text-ink-200">{fmt(existing.stake)}</span> locked.
            </p>
            <p className="text-xs text-ink-300">
              Submitting again replaces that vote. Or remove it entirely to unlock the
              stake and get the {fmt(existing.deposit)} bond back.
            </p>
            <button
              type="button"
              onClick={() => setMode(mode === 'remove' ? 'vote' : 'remove')}
              className={clsx(
                'mt-1 inline-flex items-center gap-1.5 text-xs rounded-lg px-2 py-1 border transition-colors',
                mode === 'remove'
                  ? 'text-danger border-danger/40 bg-danger/10'
                  : 'text-ink-300 border-ink-700/70 active:bg-ink-800'
              )}
            >
              <Trash2 size={12} strokeWidth={2} />
              {mode === 'remove' ? 'Cancel removal — back to voting' : 'Remove my vote instead'}
            </button>
          </div>
        )}

        {mode === 'vote' && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <label className="text-xs text-ink-300">
                  Candidates ({selected.size}/{MAX_COUNCIL_VOTES})
                </label>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1 rounded-xl border border-ink-800 p-1.5">
                {votable.map(({ address, role }) => {
                  const isSelected = selected.has(address);
                  return (
                    <button
                      key={address}
                      type="button"
                      onClick={() => toggle(address)}
                      className={clsx(
                        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors',
                        isSelected
                          ? 'bg-xx-500/10 border border-xx-500/30'
                          : 'border border-transparent active:bg-ink-800'
                      )}
                    >
                      <AddressIcon address={address} size={26} />
                      <div className="min-w-0 flex-1">
                        <AddressLabel address={address} className="text-sm" />
                        <p className="text-xs text-ink-300">{role}</p>
                      </div>
                      {isSelected && (
                        <Check size={15} className="text-xx-500 flex-shrink-0" strokeWidth={2.5} />
                      )}
                    </button>
                  );
                })}
                {votable.length === 0 && (
                  <p className="text-xs text-ink-300 text-center py-4">
                    No candidates to vote for right now.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <label className="text-xs text-ink-300">Stake to lock</label>
                <span className="text-xs text-ink-300">
                  Available: <span className="font-mono">{fmt(available)}</span>
                </span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={stakeStr}
                  onChange={(e) => setStakeStr(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0.0000"
                  className="w-full pl-3 pr-12 py-2.5 rounded-2xl bg-ink-900 border border-ink-800 text-base font-mono text-ink-100 numeric placeholder:text-ink-300 focus:outline-none focus:border-ink-600"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-300 pointer-events-none">
                  XX
                </span>
              </div>
              {minStake && (
                <p className="text-xs text-ink-300">
                  Must be more than {fmt(minStake)} (the chain's minimum balance).
                </p>
              )}
            </div>

            <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3 space-y-1">
              <p className="text-xs text-ink-300 leading-relaxed">
                Your stake stays locked (not spent) while the vote stands and counts in
                every weekly election until you remove it.
              </p>
              {newBond && (
                <p className="text-xs text-ink-300">
                  Voting bond (refunded on removal):{' '}
                  <span className="font-mono text-ink-200">{fmt(newBond)}</span>
                  {bondTopUp && existing && (
                    <> — top-up now: <span className="font-mono text-ink-200">{fmt(bondTopUp)}</span></>
                  )}
                </p>
              )}
            </div>

            <TxFooter
              signerAddress={signerAddress}
              onSignerChange={setSignerAddress}
              accounts={accounts}
              txBuilder={(api) =>
                (api.tx as any).elections.vote([...selected], stakeBn ?? new BN(0))
              }
              formValid={validation.ok === true}
              submitLabel="Submit vote"
              successTitle="Council vote submitted"
              successBody="Your vote is on chain and counts at the next weekly election."
              onDismiss={onClose}
            />

            {validation.ok === false &&
              (selected.size > 0 || stakeStr.length > 0) && (
                <p className="text-xs text-warning text-center">
                  {validationLabel(validation.error)}
                </p>
              )}
          </>
        )}

        {mode === 'remove' && existing && (
          <>
            <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3">
              <p className="text-xs text-ink-300 leading-relaxed">
                Removes this account's council vote: unlocks{' '}
                <span className="font-mono text-ink-200">{fmt(existing.stake)}</span> and
                refunds the <span className="font-mono text-ink-200">{fmt(existing.deposit)}</span>{' '}
                bond.
              </p>
            </div>
            <TxFooter
              signerAddress={signerAddress}
              onSignerChange={setSignerAddress}
              accounts={accounts}
              txBuilder={(api) => (api.tx as any).elections.removeVoter()}
              formValid={true}
              submitLabel="Remove my vote"
              successTitle="Vote removed"
              successBody="Stake unlocked and the voting bond refunded."
              onDismiss={onClose}
            />
          </>
        )}
      </div>
    </Sheet>
  );
}

function validationLabel(
  e: Exclude<ReturnType<typeof validateCouncilVote>, { ok: true }>['error']
): string {
  switch (e) {
    case 'no-candidates':
      return 'Pick at least one candidate.';
    case 'too-many-candidates':
      return `You can vote for at most ${MAX_COUNCIL_VOTES} candidates.`;
    case 'stake-required':
      return 'Enter a stake to lock.';
    case 'stake-below-minimum':
      return "Stake must be more than the chain's minimum balance.";
    case 'insufficient-balance':
      return 'Stake plus the voting bond exceeds the available balance.';
  }
}
