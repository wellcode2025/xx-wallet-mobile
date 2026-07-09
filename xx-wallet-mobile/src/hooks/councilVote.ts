/**
 * Council-election voting math + validation (elections pallet).
 *
 * Spiked live 2026-07-08 (scratch/gov-spike): xx v206 exposes
 * `elections.vote(votes: Vec<AccountId32>, value: Compact<u128>)` — vote for
 * up to `maxVotesPerVoter` (16) candidates, LOCKING `value` from free balance
 * (a lock, not a spend), plus a RESERVED bond of
 * `votingBondBase + votingBondFactor × votes.length`
 * (20.064 XX + 0.032 XX per vote on mainnet). `elections.removeVoter()`
 * removes the vote, releases the lock, and refunds the bond. Re-voting
 * replaces the existing vote and only tops the bond up for extra votes.
 *
 * Pure — unit-tested in councilVote.test.ts.
 */
import { BN } from '@polkadot/util';

/** The classic elections-phragmen per-voter cap (confirmed on xx v206). */
export const MAX_COUNCIL_VOTES = 16;

/** The reserved voting bond for `nVotes` chosen candidates. */
export function councilVoteBond(base: BN, factor: BN, nVotes: number): BN {
  return base.add(factor.muln(Math.max(0, nVotes)));
}

/**
 * How much NEW bond a vote submission reserves, given any bond already
 * reserved by the signer's existing vote (re-voting replaces it in place).
 * Never negative — the pallet refunds shrinkage on its own terms.
 */
export function additionalBond(newBond: BN, existingDeposit: BN | null): BN {
  if (!existingDeposit) return newBond;
  return newBond.gt(existingDeposit) ? newBond.sub(existingDeposit) : new BN(0);
}

export type CouncilVoteValidation =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'no-candidates'
        | 'too-many-candidates'
        | 'stake-required'
        | 'stake-below-minimum'
        | 'insufficient-balance';
    };

/**
 * Validate a council vote before building the extrinsic. Conservative on the
 * balance check: the stake (locked) and the additional bond (reserved) must
 * both come out of what's available now.
 */
export function validateCouncilVote(params: {
  selectedCount: number;
  stake: BN | null;
  available: BN;
  newBond: BN;
  existingDeposit: BN | null;
  /** The chain's existential deposit — the pallet rejects `stake <= ED` with
   *  elections.LowBalance (hit live 2026-07-08: 1 XX failed on mainnet). */
  minStake?: BN | null;
  maxVotes?: number;
}): CouncilVoteValidation {
  const max = params.maxVotes ?? MAX_COUNCIL_VOTES;
  if (params.selectedCount === 0) return { ok: false, error: 'no-candidates' };
  if (params.selectedCount > max) return { ok: false, error: 'too-many-candidates' };
  if (!params.stake || params.stake.isZero() || params.stake.isNeg()) {
    return { ok: false, error: 'stake-required' };
  }
  if (params.minStake && params.stake.lte(params.minStake)) {
    return { ok: false, error: 'stake-below-minimum' };
  }
  const bondNeeded = additionalBond(params.newBond, params.existingDeposit);
  if (params.stake.add(bondNeeded).gt(params.available)) {
    return { ok: false, error: 'insufficient-balance' };
  }
  return { ok: true };
}
