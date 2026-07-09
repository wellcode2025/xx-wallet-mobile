/**
 * Democracy public-proposal (create referendum) helpers.
 *
 * Spiked live 2026-07-08 (scratch/gov-spike): xx v206 uses BOUNDED proposals —
 * `democracy.propose(proposal: FrameSupportPreimagesBounded, value)` with the
 * separate `preimage` pallet (democracy.notePreimage is absent). The Bounded
 * enum gives two submission shapes:
 *
 *   - Inline(bytes)          — call encodings ≤ 128 bytes ride inside the
 *                              propose call itself: ONE transaction, no
 *                              preimage deposit.
 *   - Lookup { hash, len }   — larger calls need `preimage.notePreimage(bytes)`
 *                              first (per-byte deposit), then the propose
 *                              referencing blake2_256(bytes) + length.
 *
 * The proposer's deposit (≥ democracy.minimumDeposit — 100 XX on mainnet) is
 * reserved until the proposal wins a launch period and becomes a referendum.
 *
 * Pure — unit-tested in proposeReferendum.test.ts.
 */
import { BN } from '@polkadot/util';
import { blake2AsU8a } from '@polkadot/util-crypto';

/** Substrate's bound for an inline (schedule-embedded) bounded call. */
export const INLINE_BOUND_BYTES = 128;

export type BoundedShape =
  | { kind: 'inline' }
  | { kind: 'lookup'; hash: Uint8Array; len: number };

/**
 * Which Bounded shape a call encoding submits as: small calls go Inline (one
 * tx, no preimage); larger ones need a noted preimage + Lookup reference.
 */
export function boundedFor(callBytes: Uint8Array): BoundedShape {
  if (callBytes.length <= INLINE_BOUND_BYTES) return { kind: 'inline' };
  return { kind: 'lookup', hash: blake2AsU8a(callBytes, 256), len: callBytes.length };
}

export type ProposeValidation =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'call-required'
        | 'call-undecodable'
        | 'deposit-required'
        | 'deposit-below-minimum'
        | 'insufficient-balance';
    };

/**
 * Validate a proposal before building the extrinsic(s). `callDecodes` must be
 * the result of running the bytes through the wallet's decoder — proposing
 * bytes the wallet can't decode is refused outright (the §6.4 discipline: the
 * signer sees decoded truth or signs nothing).
 */
export function validatePropose(params: {
  hasCall: boolean;
  callDecodes: boolean;
  deposit: BN | null;
  minDeposit: BN;
  available: BN;
}): ProposeValidation {
  if (!params.hasCall) return { ok: false, error: 'call-required' };
  if (!params.callDecodes) return { ok: false, error: 'call-undecodable' };
  if (!params.deposit || params.deposit.isZero() || params.deposit.isNeg()) {
    return { ok: false, error: 'deposit-required' };
  }
  if (params.deposit.lt(params.minDeposit)) {
    return { ok: false, error: 'deposit-below-minimum' };
  }
  if (params.deposit.gt(params.available)) {
    return { ok: false, error: 'insufficient-balance' };
  }
  return { ok: true };
}
