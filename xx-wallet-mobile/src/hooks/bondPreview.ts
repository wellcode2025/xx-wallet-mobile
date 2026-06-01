/**
 * Bond / deposit preview math for the propose flows.
 *
 * Two pallets, two slightly different shapes — both must be
 * accurately previewed in the UI so users see what they'll lock up
 * before signing the extrinsic.
 *
 * Treasury (per substrate pallet-treasury):
 *
 *   bond = clamp(proposalBondPerMill × value / 1M,
 *                proposalBondMinimum,
 *                proposalBondMaximum)
 *
 *   On xx v206 (observed live on chain):
 *     proposalBondPerMill   = 50_000   (5%)
 *     proposalBondMinimum   = 100 XX
 *     proposalBondMaximum   = 500 XX   (Option::Some)
 *
 * Bounty (per substrate pallet-bounties):
 *
 *   deposit = bountyDepositBase + (description.bytes × dataDepositPerByte)
 *
 *   On xx v206 (observed live on chain):
 *     bountyDepositBase     = 1 XX
 *     dataDepositPerByte    = 0.01 XX
 *
 * Pure functions. Tested with the chain-observed constants so the
 * preview math is wired to chain reality, not a documented assumption.
 */

import { BN } from '@polkadot/util';

export interface TreasuryBondParams {
  /** Proposal value being requested, in planck. */
  value: BN;
  /** Permill rate (substrate-canonical: 50_000 = 5%). */
  bondPerMill: number;
  /** Minimum bond, in planck. */
  bondMinimum: BN;
  /** Maximum bond if the chain caps it, in planck. Null when uncapped. */
  bondMaximum: BN | null;
}

/**
 * Compute the treasury proposal bond for a given value.
 *
 * Result is the Permill scaling of the value, floored at min and
 * (when present) capped at max. The chain enforces the same clamp;
 * a UI mismatch would fee-burn the proposer.
 */
export function treasuryBond(p: TreasuryBondParams): BN {
  const PER_MILL = new BN(1_000_000);
  const scaled = p.value.muln(p.bondPerMill).div(PER_MILL);
  let bond = scaled.lt(p.bondMinimum) ? p.bondMinimum : scaled;
  if (p.bondMaximum && bond.gt(p.bondMaximum)) bond = p.bondMaximum;
  return bond;
}

export interface BountyDepositParams {
  /** Bytes length of the description, NOT JS char count. */
  descriptionBytes: number;
  /** Base deposit, in planck. */
  depositBase: BN;
  /** Per-byte addendum, in planck. */
  dataDepositPerByte: BN;
}

/**
 * Compute the bounty proposer deposit.
 *
 * Returns base + (bytes × per-byte). The chain rejects a
 * `proposeBounty` whose deposit can't be reserved from the proposer's
 * transferable balance.
 */
export function bountyDeposit(p: BountyDepositParams): BN {
  return p.depositBase.add(p.dataDepositPerByte.muln(p.descriptionBytes));
}

/**
 * Count UTF-8 bytes in a string — what the chain measures, not the
 * JS char count. ASCII chars are 1 byte; the forum-link convention on
 * xx is ASCII URLs + ASCII titles so usually they coincide, but
 * defensive against non-ASCII (e.g. emoji in titles).
 */
export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}
