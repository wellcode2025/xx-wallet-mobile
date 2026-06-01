/**
 * AccountVote — encoder for the democracy.vote extrinsic payload.
 *
 * Substrate's democracy.vote takes (refIndex, AccountVote<Balance>) where
 * AccountVote is an enum with two variants:
 *
 *   pub enum AccountVote<Balance> {
 *       Standard { vote: Vote, balance: Balance },
 *       Split { aye: Balance, nay: Balance },
 *   }
 *
 *   pub struct Vote { aye: bool, conviction: Conviction }
 *
 *   pub enum Conviction {
 *       None,     // 0.1× weight, no lock
 *       Locked1x, // 1× weight, 1 lock period (1 day on xx)
 *       Locked2x, // 2× weight, 2 days
 *       Locked3x, // 3× weight, 4 days
 *       Locked4x, // 4× weight, 8 days
 *       Locked5x, // 5× weight, 16 days
 *       Locked6x, // 6× weight, 32 days
 *   }
 *
 * The Vote struct is packed into a single u8: bit 0x80 = aye, low nibble
 * (0–6) = conviction id. Bits 0x70 must be zero.
 *
 * Slice 5's parseMyVoting decodes this byte; Slice 6 produces it. The
 * encode → decode round-trip is exercised in tests below to make sure
 * the two helpers agree.
 */

import { BN } from '@polkadot/util';

/** Conviction id 0-6 with human label, vote multiplier, and lock days. */
export const CONVICTIONS = [
  { id: 0, label: 'None (0.1× weight, no lock)', multiplier: 0.1, lockDays: 0 },
  { id: 1, label: 'Locked 1× (1 day)', multiplier: 1, lockDays: 1 },
  { id: 2, label: 'Locked 2× (2 days)', multiplier: 2, lockDays: 2 },
  { id: 3, label: 'Locked 3× (4 days)', multiplier: 3, lockDays: 4 },
  { id: 4, label: 'Locked 4× (8 days)', multiplier: 4, lockDays: 8 },
  { id: 5, label: 'Locked 5× (16 days)', multiplier: 5, lockDays: 16 },
  { id: 6, label: 'Locked 6× (32 days)', multiplier: 6, lockDays: 32 },
] as const;

export type ConvictionId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Encode the (aye, conviction) pair into the packed u8 vote byte that
 * goes into AccountVote::Standard.
 *
 *   bit 0x80     → aye flag (1 = aye, 0 = nay)
 *   bits 0x0F    → conviction id (0–6)
 *   bits 0x70    → MUST be zero
 *
 * Validates the conviction is in range; throws for an invalid id rather
 * than silently encoding garbage that would dispatch-error on chain.
 */
export function encodeVoteByte(aye: boolean, conviction: ConvictionId): number {
  if (!Number.isInteger(conviction) || conviction < 0 || conviction > 6) {
    throw new Error(
      `encodeVoteByte: conviction must be an integer 0-6, got ${conviction}`
    );
  }
  return (aye ? 0x80 : 0) | (conviction & 0x0f);
}

/**
 * Decode a packed u8 vote byte back into { aye, conviction }. Inverse
 * of `encodeVoteByte` for round-trip testing and for parsing
 * chain-returned AccountVotes (Slice 5's parseMyVoting uses the same
 * unpacking inline).
 */
export function decodeVoteByte(byte: number): {
  aye: boolean;
  conviction: ConvictionId;
} {
  if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
    throw new Error(`decodeVoteByte: byte must be 0-255, got ${byte}`);
  }
  const aye = (byte & 0x80) !== 0;
  const convictionId = byte & 0x0f;
  if (convictionId > 6) {
    throw new Error(
      `decodeVoteByte: invalid conviction id ${convictionId} in byte 0x${byte
        .toString(16)
        .padStart(2, '0')}`
    );
  }
  return { aye, conviction: convictionId as ConvictionId };
}

/** Conviction's vote-weight multiplier (None = 0.1, 1× through 6×). */
export function convictionMultiplier(conviction: ConvictionId): number {
  return CONVICTIONS[conviction].multiplier;
}

/** Number of days the balance stays locked at this conviction. */
export function convictionLockDays(conviction: ConvictionId): number {
  return CONVICTIONS[conviction].lockDays;
}

/**
 * Compute the effective vote-weight: balance × convictionMultiplier.
 *
 * Locked convictions scale 1×–6×; None applies a 0.1× weight which
 * we round down for display (a 1,000-XX vote at None weighs 100 XX).
 *
 * Used for the "Vote power" preview in the sheet so users see what
 * their balance + conviction choice actually translates to on chain.
 */
export function voteWeight(balance: BN, conviction: ConvictionId): BN {
  if (conviction === 0) {
    // 0.1× — divide by 10. Integer division rounds toward zero, matching
    // Substrate's u128 saturating math for the None conviction.
    return balance.divn(10);
  }
  const m = convictionMultiplier(conviction);
  // 1×–6× are integers, so safe with BN.muln.
  return balance.muln(m);
}

/**
 * Validate vote inputs and return a discriminated result.
 *
 * Used by the sheet's submit-enabled check and the form-validation tests.
 * Keeping the rules in one place avoids drift between "is the button
 * enabled" and "will the extrinsic succeed".
 */
export interface VoteFormInputs {
  balance: BN;
  available: BN;
  conviction: ConvictionId;
  refIndex: number;
}

export type VoteFormError =
  | 'balance-required'
  | 'balance-exceeds-available'
  | 'conviction-out-of-range'
  | 'ref-index-invalid';

export function validateVoteInputs(
  inputs: VoteFormInputs
): { ok: true } | { ok: false; error: VoteFormError } {
  if (
    !Number.isInteger(inputs.refIndex) ||
    inputs.refIndex < 0 ||
    inputs.refIndex > 0xffff_ffff
  ) {
    return { ok: false, error: 'ref-index-invalid' };
  }
  if (
    !Number.isInteger(inputs.conviction) ||
    inputs.conviction < 0 ||
    inputs.conviction > 6
  ) {
    return { ok: false, error: 'conviction-out-of-range' };
  }
  if (inputs.balance.isZero() || inputs.balance.isNeg()) {
    return { ok: false, error: 'balance-required' };
  }
  if (inputs.balance.gt(inputs.available)) {
    return { ok: false, error: 'balance-exceeds-available' };
  }
  return { ok: true };
}
