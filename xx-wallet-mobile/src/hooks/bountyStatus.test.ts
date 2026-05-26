/**
 * Tests for the bounty status decoder + label helpers.
 *
 * We synthesise polkadot-codec-shaped stubs (objects with `isFoo` flags
 * and matching `asFoo` accessors) rather than wiring a real ApiPromise.
 * The decoder reads through those same accessors at runtime, so the
 * stubs exercise the same branches the real codec does.
 */

import { describe, expect, it } from 'vitest';
import {
  curatorAddressOf,
  decodeBountyStatus,
  statusLabel,
  type BountyStatus,
} from './bountyStatus';

const CURATOR = '6ZAPjLeWygQ1TtNDovPZuEWgGrxkgQzPtmjWqwWitJPb591v';
const BENEFICIARY = '6YDEf5Q78EFHbmiJRFqfpNpiGQjMZf1Cqpy2Dmi8FRYJVTCQ';

const stubAddress = (s: string) => ({ toString: () => s });
const stubBlock = (n: number) => ({ toNumber: () => n });

function withFlags(
  flagKey: string,
  asPayload?: unknown,
  toJSON?: unknown
): any {
  const o: any = {
    isProposed: false,
    isFunded: false,
    isCuratorProposed: false,
    isActive: false,
    isPendingPayout: false,
    toJSON: () => toJSON ?? {},
  };
  o[flagKey] = true;
  if (asPayload !== undefined) {
    const asKey = `as${flagKey.slice(2)}`;
    o[asKey] = asPayload;
  }
  return o;
}

describe('decodeBountyStatus', () => {
  it('maps Proposed to { kind: "proposed" }', () => {
    const codec = withFlags('isProposed', undefined, { proposed: null });
    expect(decodeBountyStatus(codec)).toEqual({ kind: 'proposed' });
  });

  it('maps Funded to { kind: "funded" }', () => {
    const codec = withFlags('isFunded', undefined, { funded: null });
    expect(decodeBountyStatus(codec)).toEqual({ kind: 'funded' });
  });

  it('maps CuratorProposed and unpacks the curator address', () => {
    const codec = withFlags('isCuratorProposed', {
      curator: stubAddress(CURATOR),
    });
    expect(decodeBountyStatus(codec)).toEqual({
      kind: 'curatorProposed',
      curator: CURATOR,
    });
  });

  it('maps Active and unpacks curator + updateDue block', () => {
    const codec = withFlags('isActive', {
      curator: stubAddress(CURATOR),
      updateDue: stubBlock(23_932_462),
    });
    expect(decodeBountyStatus(codec)).toEqual({
      kind: 'active',
      curator: CURATOR,
      updateDue: 23_932_462,
    });
  });

  it('maps PendingPayout and unpacks curator + beneficiary + unlockAt', () => {
    const codec = withFlags('isPendingPayout', {
      curator: stubAddress(CURATOR),
      beneficiary: stubAddress(BENEFICIARY),
      unlockAt: stubBlock(24_000_000),
    });
    expect(decodeBountyStatus(codec)).toEqual({
      kind: 'pendingPayout',
      curator: CURATOR,
      beneficiary: BENEFICIARY,
      unlockAt: 24_000_000,
    });
  });

  it('falls through to "unknown" when no isFoo flag matches', () => {
    const codec = {
      isProposed: false,
      isFunded: false,
      isCuratorProposed: false,
      isActive: false,
      isPendingPayout: false,
      toJSON: () => ({ someFutureVariant: { foo: 1 } }),
    };
    const result = decodeBountyStatus(codec);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.raw).toEqual({ someFutureVariant: { foo: 1 } });
    }
  });

  it('does not crash if isFoo accessor throws — falls through to unknown', () => {
    const codec = {
      get isProposed() {
        throw new Error('codec deserialization failure');
      },
      toJSON: () => ({ broken: true }),
    };
    const result = decodeBountyStatus(codec);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      expect(result.raw).toEqual({ broken: true });
    }
  });
});

describe('curatorAddressOf', () => {
  it('returns the curator for active', () => {
    const s: BountyStatus = {
      kind: 'active',
      curator: CURATOR,
      updateDue: 1000,
    };
    expect(curatorAddressOf(s)).toBe(CURATOR);
  });

  it('returns the curator for curatorProposed', () => {
    const s: BountyStatus = { kind: 'curatorProposed', curator: CURATOR };
    expect(curatorAddressOf(s)).toBe(CURATOR);
  });

  it('returns the curator for pendingPayout', () => {
    const s: BountyStatus = {
      kind: 'pendingPayout',
      curator: CURATOR,
      beneficiary: BENEFICIARY,
      unlockAt: 1000,
    };
    expect(curatorAddressOf(s)).toBe(CURATOR);
  });

  it('returns null for proposed (no curator yet)', () => {
    expect(curatorAddressOf({ kind: 'proposed' })).toBeNull();
  });

  it('returns null for funded (no curator yet)', () => {
    expect(curatorAddressOf({ kind: 'funded' })).toBeNull();
  });

  it('returns null for unknown', () => {
    expect(curatorAddressOf({ kind: 'unknown', raw: null })).toBeNull();
  });
});

describe('statusLabel', () => {
  it('produces a label for every variant', () => {
    expect(statusLabel({ kind: 'proposed' })).toBe('Proposed');
    expect(statusLabel({ kind: 'funded' })).toBe('Funded');
    expect(statusLabel({ kind: 'curatorProposed', curator: CURATOR })).toBe(
      'Curator proposed'
    );
    expect(
      statusLabel({ kind: 'active', curator: CURATOR, updateDue: 1 })
    ).toBe('Active');
    expect(
      statusLabel({
        kind: 'pendingPayout',
        curator: CURATOR,
        beneficiary: BENEFICIARY,
        unlockAt: 1,
      })
    ).toBe('Pending payout');
    expect(statusLabel({ kind: 'unknown', raw: null })).toBe('Status: unknown');
  });
});
