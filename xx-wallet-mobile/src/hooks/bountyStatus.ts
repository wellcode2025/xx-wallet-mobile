/**
 * Bounty status enum — typed discriminant + decoder.
 *
 * Shared between useBounties (list) and useBountyDetail (single).
 * Substrate's bounty pallet exposes a runtime enum with five variants;
 * we map them to a local discriminated union so the rest of the code
 * can switch on `status.kind` without leaning on polkadot-codec's
 * `isFoo` / `asFoo` runtime accessors.
 *
 * The defensive `unknown` fallback exists to keep the screen rendering
 * if the runtime ever adds a sixth variant: we surface the raw JSON
 * for debug visibility, but the row + detail still draw their other
 * fields. See  "Slice 1 Risks".
 */

export type BountyStatus =
  | { kind: 'proposed' }
  | { kind: 'funded' }
  | { kind: 'curatorProposed'; curator: string }
  | { kind: 'active'; curator: string; updateDue: number }
  | {
      kind: 'pendingPayout';
      curator: string;
      beneficiary: string;
      unlockAt: number;
    }
  | { kind: 'unknown'; raw: unknown };

/**
 * Decode a polkadot-codec BountyStatus into the local typed union.
 *
 * Accepts the codec's runtime accessor object (with `isProposed`,
 * `isFunded`, etc.). Returns `{ kind: 'unknown', raw }` for variants we
 * don't recognise so callers can still render the row.
 */
export function decodeBountyStatus(statusCodec: any): BountyStatus {
  try {
    if (statusCodec.isProposed) return { kind: 'proposed' };
    if (statusCodec.isFunded) return { kind: 'funded' };
    if (statusCodec.isCuratorProposed) {
      const inner = statusCodec.asCuratorProposed;
      return { kind: 'curatorProposed', curator: inner.curator.toString() };
    }
    if (statusCodec.isActive) {
      const inner = statusCodec.asActive;
      return {
        kind: 'active',
        curator: inner.curator.toString(),
        updateDue: inner.updateDue.toNumber(),
      };
    }
    if (statusCodec.isPendingPayout) {
      const inner = statusCodec.asPendingPayout;
      return {
        kind: 'pendingPayout',
        curator: inner.curator.toString(),
        beneficiary: inner.beneficiary.toString(),
        unlockAt: inner.unlockAt.toNumber(),
      };
    }
  } catch {
    /* fall through */
  }
  let raw: unknown = null;
  try {
    raw = statusCodec.toJSON();
  } catch {
    raw = String(statusCodec);
  }
  return { kind: 'unknown', raw };
}

/**
 * Pull the curator account from a status variant, if it has one.
 * Returns null for Proposed / Funded / Unknown statuses (no curator
 * yet, or status shape isn't recognised).
 */
export function curatorAddressOf(status: BountyStatus): string | null {
  switch (status.kind) {
    case 'curatorProposed':
    case 'active':
    case 'pendingPayout':
      return status.curator;
    default:
      return null;
  }
}

/**
 * Human-readable status label for the badge UI. Maps to the web
 * wallet's wording. Use BountyStatusBadge to render colored pills.
 */
export function statusLabel(status: BountyStatus): string {
  switch (status.kind) {
    case 'proposed':
      return 'Proposed';
    case 'funded':
      return 'Funded';
    case 'curatorProposed':
      return 'Curator proposed';
    case 'active':
      return 'Active';
    case 'pendingPayout':
      return 'Pending payout';
    case 'unknown':
      return 'Status: unknown';
  }
}
