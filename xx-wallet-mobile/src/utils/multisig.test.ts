/**
 * Tests for multisig address derivation and verification.
 *
 * Why these matter:
 * - `deriveMultisigAddress` is the single source of truth for "what address
 *   does this (threshold, signers) tuple correspond to?" If it ever returns
 *   the wrong answer for a real foundation multisig, every downstream
 *   verification (JSON config import, approval-time address check) fails
 *   silently — the wallet would let users approve actions at addresses
 *   different from what they thought they were approving at.
 * - The fixture below pins the derivation against the live foundation
 *   operations multisig (`6Zihn…HnU8M`, 2-of-4 over the four known signer
 *   accounts) observed in the multisig spike. If this test fails, either
 *   the wallet's derivation is wrong, the live chain data was misinterpreted,
 *   or @polkadot/util-crypto's createKeyMulti behavior changed.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import {
  cryptoWaitReady,
  decodeAddress,
  encodeAddress,
} from '@polkadot/util-crypto';
import {
  canonicalConfigJson,
  configHashOf,
  deriveMultisigAddress,
  multisigAddressMatches,
} from './multisig';

// The foundation operations multisig, observed live during the multisig
// spike (see scripts/spikes/multisig-spike-address.mjs). Address, threshold,
// and signer set were extracted from real `multisig.asMulti` extrinsics on
// `wss://rpc.xx.network`.
const FOUNDATION_OPS = {
  address: '6ZihnXBA64KAFFGfdYHxKWeWKLpw28pxPANjuSWsPp1HnU8M',
  threshold: 2,
  signers: [
    '6WwjYDmMb3MuoXvWHN357UzHY9VsJpFbJYbgQ1Vz1aY2PojL', // Aaron
    '6YDEf5Q78EFHbmiJRFqfpNpiGQjMZf1Cqpy2Dmi8FRYJVTCQ', // Rick
    '6Z4ibreHzd4SJR7EnBwMHC1WBG4xPG7baMtGxt4Dk5JCwv1n', // Keith
    '6aA1Mm6FNw9YXGra7NGu4tmDjgJdrNkDD6JPdJFXs35QKGKp', // Jim
  ],
};

// Another known-real xx address from decoded live transfer history
// (recurring recipient of foundation outflows; full form appears in the
// nested_calls JSON returned by the indexer). Used as a synthetic 5th
// signer to exercise the 3-of-5 derivation case with an address we know
// round-trips through SS58 validation cleanly.
const ARBITRARY_XX_ADDRESS = '6VzvTmYvWMukH2VuBXXUhXrxmc9SEL7uDXfcWU2rgZJQUYdo';

describe('deriveMultisigAddress', () => {
  beforeAll(async () => {
    // blake2 / sr25519 derivation depends on @polkadot's WASM crypto.
    await cryptoWaitReady();
  });

  describe('known-correct cases', () => {
    it('matches the live foundation operations multisig (2-of-4)', () => {
      // The canary. If this fails, derivation is wrong and nothing
      // downstream is trustworthy until it's fixed.
      const derived = deriveMultisigAddress(
        FOUNDATION_OPS.threshold,
        FOUNDATION_OPS.signers
      );
      expect(derived).toBe(FOUNDATION_OPS.address);
    });

    it('is order-independent — signers can be passed in any order', () => {
      const a = deriveMultisigAddress(2, FOUNDATION_OPS.signers);
      const b = deriveMultisigAddress(2, [...FOUNDATION_OPS.signers].reverse());
      const c = deriveMultisigAddress(2, [
        FOUNDATION_OPS.signers[2],
        FOUNDATION_OPS.signers[0],
        FOUNDATION_OPS.signers[3],
        FOUNDATION_OPS.signers[1],
      ]);
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(a).toBe(FOUNDATION_OPS.address);
    });

    it('handles a 2-of-3 (synthetic, but exercising the same derivation)', () => {
      const signers = FOUNDATION_OPS.signers.slice(0, 3);
      const derived = deriveMultisigAddress(2, signers);
      expect(derived).toMatch(/^6[1-9A-HJ-NP-Za-km-z]{47}$/);
      // Order-independence holds at this size too.
      expect(derived).toBe(deriveMultisigAddress(2, [...signers].reverse()));
      // Different signer set => different derived address (sanity).
      expect(derived).not.toBe(FOUNDATION_OPS.address);
    });

    it('handles a 3-of-5 (4 foundation signers + a 5th)', () => {
      const signers = [...FOUNDATION_OPS.signers, ARBITRARY_XX_ADDRESS];
      const derived = deriveMultisigAddress(3, signers);
      expect(derived).toMatch(/^6[1-9A-HJ-NP-Za-km-z]{47}$/);
      expect(derived).not.toBe(FOUNDATION_OPS.address);
    });

    it('threshold matters: 1-of-N, 2-of-N, 3-of-N, N-of-N all derive distinctly', () => {
      const a = deriveMultisigAddress(1, FOUNDATION_OPS.signers);
      const b = deriveMultisigAddress(2, FOUNDATION_OPS.signers);
      const c = deriveMultisigAddress(3, FOUNDATION_OPS.signers);
      const d = deriveMultisigAddress(4, FOUNDATION_OPS.signers);
      expect(new Set([a, b, c, d]).size).toBe(4);
      // Spot-check: 2-of-4 IS the foundation multisig; the others aren't.
      expect(b).toBe(FOUNDATION_OPS.address);
      expect(a).not.toBe(FOUNDATION_OPS.address);
      expect(c).not.toBe(FOUNDATION_OPS.address);
      expect(d).not.toBe(FOUNDATION_OPS.address);
    });
  });

  describe('rejects bad input', () => {
    it('throws on threshold of 0', () => {
      expect(() => deriveMultisigAddress(0, FOUNDATION_OPS.signers)).toThrow(
        /threshold/i
      );
    });

    it('throws on negative threshold', () => {
      expect(() => deriveMultisigAddress(-1, FOUNDATION_OPS.signers)).toThrow(
        /threshold/i
      );
    });

    it('throws on non-integer threshold', () => {
      expect(() => deriveMultisigAddress(1.5, FOUNDATION_OPS.signers)).toThrow(
        /threshold/i
      );
    });

    it('throws on threshold exceeding signer count', () => {
      expect(() => deriveMultisigAddress(5, FOUNDATION_OPS.signers)).toThrow(
        /exceeds signer count/i
      );
    });

    it('throws on a single-signer "multisig" (not a multisig at all)', () => {
      expect(() =>
        deriveMultisigAddress(1, [FOUNDATION_OPS.signers[0]])
      ).toThrow(/at least 2 signers/i);
    });

    it('throws on empty signer set', () => {
      expect(() => deriveMultisigAddress(1, [])).toThrow(/at least 2 signers/i);
    });

    it('throws on garbage in the signer set', () => {
      expect(() =>
        deriveMultisigAddress(2, [
          FOUNDATION_OPS.signers[0],
          'not-a-real-address',
        ])
      ).toThrow(/Invalid xx network address/i);
    });

    it('throws on a Polkadot-format address (wrong SS58 prefix)', () => {
      // A real Polkadot address (prefix 0). Valid SS58 but wrong network —
      // the wallet must not silently coerce to xx, which would derive an
      // address the user never intended.
      const polkadotAddress = '15nPkPKt4VCmtjEsLebqEbHi7nQ4eQpmgXRTsxaeoojbE2nQ';
      expect(() =>
        deriveMultisigAddress(2, [
          FOUNDATION_OPS.signers[0],
          polkadotAddress,
        ])
      ).toThrow(/Invalid xx network address/i);
    });
  });
});

describe('multisigAddressMatches', () => {
  beforeAll(async () => {
    await cryptoWaitReady();
  });

  it('returns true when claim matches derivation (the happy path)', () => {
    expect(
      multisigAddressMatches(
        FOUNDATION_OPS.address,
        FOUNDATION_OPS.threshold,
        FOUNDATION_OPS.signers
      )
    ).toBe(true);
  });

  it('returns false when threshold is wrong (depositor lying about threshold)', () => {
    expect(
      multisigAddressMatches(FOUNDATION_OPS.address, 3, FOUNDATION_OPS.signers)
    ).toBe(false);
  });

  it('returns false when a signer is swapped (the attack we are guarding against)', () => {
    // Substitute one signer for another valid xx address. This is the
    // poisoned-config attack: a JSON claims address X but lists signers
    // that derive to a different address. The check must catch it.
    const tamperedSigners = [...FOUNDATION_OPS.signers];
    tamperedSigners[0] = ARBITRARY_XX_ADDRESS;
    expect(
      multisigAddressMatches(
        FOUNDATION_OPS.address,
        FOUNDATION_OPS.threshold,
        tamperedSigners
      )
    ).toBe(false);
  });

  it('returns false on garbage input rather than throwing', () => {
    // The check is a guard, not a validator — it returns false on
    // malformed inputs. Throwing would force every caller to wrap in
    // try/catch; they wouldn't, and one of them would forget.
    expect(
      multisigAddressMatches('not-an-address', 2, FOUNDATION_OPS.signers)
    ).toBe(false);
    expect(
      multisigAddressMatches(FOUNDATION_OPS.address, 0, FOUNDATION_OPS.signers)
    ).toBe(false);
    expect(
      multisigAddressMatches(FOUNDATION_OPS.address, 2, ['nope'])
    ).toBe(false);
  });

  it('tolerates the claimed address being in another SS58 format', () => {
    // The same multisig public key encoded with prefix 0 (Polkadot). The
    // wallet should normalise both sides and still return true — this
    // covers the case of a user pasting the address from a Polkadot
    // explorer that re-encoded it for display.
    const polkadotEncoded = encodeAddress(
      decodeAddress(FOUNDATION_OPS.address),
      0
    );
    expect(
      multisigAddressMatches(
        polkadotEncoded,
        FOUNDATION_OPS.threshold,
        FOUNDATION_OPS.signers
      )
    ).toBe(true);
  });
});

describe('canonicalConfigJson', () => {
  it('produces the same canonical form regardless of input signer order', () => {
    const a = canonicalConfigJson(2, FOUNDATION_OPS.signers);
    const b = canonicalConfigJson(2, [...FOUNDATION_OPS.signers].reverse());
    expect(a).toBe(b);
  });

  it('emits keys in a fixed order (threshold then signers)', () => {
    const json = canonicalConfigJson(2, FOUNDATION_OPS.signers);
    // Threshold key must appear before signers key for stable hashing.
    const thresholdIdx = json.indexOf('"threshold"');
    const signersIdx = json.indexOf('"signers"');
    expect(thresholdIdx).toBeGreaterThan(-1);
    expect(signersIdx).toBeGreaterThan(thresholdIdx);
  });

  it('includes only threshold + signers (no nicknames or metadata)', () => {
    const json = canonicalConfigJson(2, FOUNDATION_OPS.signers);
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed).sort()).toEqual(['signers', 'threshold']);
  });

  it('different thresholds at the same signer set produce different canonical forms', () => {
    const a = canonicalConfigJson(2, FOUNDATION_OPS.signers);
    const b = canonicalConfigJson(3, FOUNDATION_OPS.signers);
    expect(a).not.toBe(b);
  });
});

describe('configHashOf', () => {
  it('produces the same hash regardless of input signer order', async () => {
    const a = await configHashOf(2, FOUNDATION_OPS.signers);
    const b = await configHashOf(2, [...FOUNDATION_OPS.signers].reverse());
    expect(a).toBe(b);
  });

  it('produces different hashes for different (threshold, signers) tuples', async () => {
    const a = await configHashOf(2, FOUNDATION_OPS.signers);
    const b = await configHashOf(3, FOUNDATION_OPS.signers);
    const c = await configHashOf(
      2,
      [...FOUNDATION_OPS.signers, ARBITRARY_XX_ADDRESS]
    );
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('uses crypto.subtle in test env (returns a hex SHA-256)', async () => {
    // Vitest `node` environment exposes `globalThis.crypto.subtle` from
    // Node 19+. If this test ever fails, either the test env regressed
    // or the fallback path silently activated — either is worth knowing.
    const hash = await configHashOf(2, FOUNDATION_OPS.signers);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash.startsWith('dev-djb2-')).toBe(false);
  });
});
