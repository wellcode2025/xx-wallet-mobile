/**
 * Tests for multisig config build/parse cycle.
 *
 * The single load-bearing check is address-derivation matching: a
 * tampered config that swaps a signer must be refused. Most of these
 * tests are variations on "did we catch this kind of tampering?"
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { cryptoWaitReady } from '@polkadot/util-crypto';
import {
  buildMultisigConfig,
  parseMultisigConfig,
  serializeMultisigConfig,
} from './multisigConfig';
import { deriveMultisigAddress } from './multisig';

// Real xx network signer addresses (foundation operations multisig).
const FOUNDATION_SIGNERS = [
  '6WwjYDmMb3MuoXvWHN357UzHY9VsJpFbJYbgQ1Vz1aY2PojL',
  '6YDEf5Q78EFHbmiJRFqfpNpiGQjMZf1Cqpy2Dmi8FRYJVTCQ',
  '6Z4ibreHzd4SJR7EnBwMHC1WBG4xPG7baMtGxt4Dk5JCwv1n',
  '6aA1Mm6FNw9YXGra7NGu4tmDjgJdrNkDD6JPdJFXs35QKGKp',
];
const FOUNDATION_ADDRESS =
  '6ZihnXBA64KAFFGfdYHxKWeWKLpw28pxPANjuSWsPp1HnU8M';
const FOUNDATION_THRESHOLD = 2;

// Another real xx address used as a "different signer" for tamper tests.
const OTHER_SIGNER = '6VzvTmYvWMukH2VuBXXUhXrxmc9SEL7uDXfcWU2rgZJQUYdo';

beforeAll(async () => {
  // address derivation needs WASM crypto initialized.
  await cryptoWaitReady();
});

describe('buildMultisigConfig', () => {
  it('produces a valid config from matching address + signers', () => {
    const cfg = buildMultisigConfig({
      multisigAddress: FOUNDATION_ADDRESS,
      threshold: FOUNDATION_THRESHOLD,
      signers: FOUNDATION_SIGNERS,
    });
    expect(cfg.format).toBe('xx-wallet-multisig-config');
    expect(cfg.version).toBe(1);
    expect(cfg.multisigAddress).toBe(FOUNDATION_ADDRESS);
    expect(cfg.threshold).toBe(2);
    expect(cfg.signers).toHaveLength(4);
    // Stamped timestamp present
    expect(cfg.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sorts signers into canonical order regardless of input order', () => {
    const a = buildMultisigConfig({
      multisigAddress: FOUNDATION_ADDRESS,
      threshold: FOUNDATION_THRESHOLD,
      signers: FOUNDATION_SIGNERS,
    });
    const b = buildMultisigConfig({
      multisigAddress: FOUNDATION_ADDRESS,
      threshold: FOUNDATION_THRESHOLD,
      signers: [...FOUNDATION_SIGNERS].reverse(),
    });
    expect(a.signers).toEqual(b.signers);
  });

  it('throws when claimed address does not match derived address', () => {
    // Same signer set, but claim a wrong multisig address.
    expect(() =>
      buildMultisigConfig({
        multisigAddress:
          '6VzvTmYvWMukH2VuBXXUhXrxmc9SEL7uDXfcWU2rgZJQUYdo', // wrong
        threshold: FOUNDATION_THRESHOLD,
        signers: FOUNDATION_SIGNERS,
      })
    ).toThrow(/does not match the address derived/i);
  });

  it('throws on threshold of 0', () => {
    expect(() =>
      buildMultisigConfig({
        multisigAddress: FOUNDATION_ADDRESS,
        threshold: 0,
        signers: FOUNDATION_SIGNERS,
      })
    ).toThrow(/threshold/i);
  });

  it('throws on threshold > signer count', () => {
    expect(() =>
      buildMultisigConfig({
        multisigAddress: FOUNDATION_ADDRESS,
        threshold: 5,
        signers: FOUNDATION_SIGNERS,
      })
    ).toThrow(/exceeds signer count/i);
  });

  it('throws on fewer than 2 signers', () => {
    expect(() =>
      buildMultisigConfig({
        multisigAddress: FOUNDATION_ADDRESS,
        threshold: 1,
        signers: [FOUNDATION_SIGNERS[0]],
      })
    ).toThrow(/at least 2 signers/i);
  });

  it('throws on invalid multisigAddress', () => {
    expect(() =>
      buildMultisigConfig({
        multisigAddress: 'not-an-address',
        threshold: FOUNDATION_THRESHOLD,
        signers: FOUNDATION_SIGNERS,
      })
    ).toThrow(/invalid multisigAddress/i);
  });

  it('throws on invalid signer address', () => {
    expect(() =>
      buildMultisigConfig({
        multisigAddress: FOUNDATION_ADDRESS,
        threshold: FOUNDATION_THRESHOLD,
        signers: [...FOUNDATION_SIGNERS.slice(0, 3), 'nope'],
      })
    ).toThrow(/invalid signer address/i);
  });

  it('throws on invalid createdBy when present', () => {
    expect(() =>
      buildMultisigConfig({
        multisigAddress: FOUNDATION_ADDRESS,
        threshold: FOUNDATION_THRESHOLD,
        signers: FOUNDATION_SIGNERS,
        createdBy: 'not-an-address',
      })
    ).toThrow(/createdBy must be a valid xx address/i);
  });

  it('caps suggestedName at the max length', () => {
    const longName = 'x'.repeat(200);
    const cfg = buildMultisigConfig({
      multisigAddress: FOUNDATION_ADDRESS,
      threshold: FOUNDATION_THRESHOLD,
      signers: FOUNDATION_SIGNERS,
      suggestedName: longName,
    });
    expect(cfg.suggestedName?.length).toBe(64);
  });
});

describe('parseMultisigConfig — happy path', () => {
  it('round-trips a built config via serialize/parse', () => {
    const original = buildMultisigConfig({
      multisigAddress: FOUNDATION_ADDRESS,
      threshold: FOUNDATION_THRESHOLD,
      signers: FOUNDATION_SIGNERS,
      suggestedName: 'Foundation Operations',
      createdBy: FOUNDATION_SIGNERS[0],
    });
    const json = serializeMultisigConfig(original);
    const parsed = parseMultisigConfig(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config.multisigAddress).toBe(FOUNDATION_ADDRESS);
      expect(parsed.config.threshold).toBe(FOUNDATION_THRESHOLD);
      expect(parsed.config.signers).toHaveLength(4);
      expect(parsed.config.suggestedName).toBe('Foundation Operations');
      expect(parsed.config.createdBy).toBe(FOUNDATION_SIGNERS[0]);
    }
  });

  it('accepts an already-parsed object too', () => {
    const original = buildMultisigConfig({
      multisigAddress: FOUNDATION_ADDRESS,
      threshold: FOUNDATION_THRESHOLD,
      signers: FOUNDATION_SIGNERS,
    });
    const parsed = parseMultisigConfig(original as unknown);
    expect(parsed.ok).toBe(true);
  });

  it('silently ignores unknown extra fields (forward compat + injection safety)', () => {
    const original = buildMultisigConfig({
      multisigAddress: FOUNDATION_ADDRESS,
      threshold: FOUNDATION_THRESHOLD,
      signers: FOUNDATION_SIGNERS,
    });
    const augmented = {
      ...original,
      // Attacker-injected fields that might look meaningful — must
      // not propagate into the parsed config.
      maliciousIntent: 'pay the attacker',
      hiddenSigner: '6Vzv…UYdo',
    };
    const parsed = parseMultisigConfig(augmented as unknown);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const keys = Object.keys(parsed.config).sort();
      expect(keys).toEqual([
        'createdAt',
        'format',
        'multisigAddress',
        'signers',
        'threshold',
        'version',
      ]);
    }
  });

  it('produces a stable canonical signer order even if input was scrambled', () => {
    const original = buildMultisigConfig({
      multisigAddress: FOUNDATION_ADDRESS,
      threshold: FOUNDATION_THRESHOLD,
      signers: FOUNDATION_SIGNERS,
    });
    const scrambled = {
      ...original,
      signers: [...original.signers].reverse(),
    };
    const parsed = parseMultisigConfig(scrambled as unknown);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // Should sort to the same canonical order
      expect(parsed.config.signers).toEqual([...original.signers].sort());
    }
  });
});

describe('parseMultisigConfig — refuses tampered or malformed input', () => {
  function makeValid() {
    return buildMultisigConfig({
      multisigAddress: FOUNDATION_ADDRESS,
      threshold: FOUNDATION_THRESHOLD,
      signers: FOUNDATION_SIGNERS,
    });
  }

  it('refuses on missing format discriminator', () => {
    const valid = makeValid();
    const { format: _f, ...bad } = valid;
    const parsed = parseMultisigConfig(bad as unknown);
    expect(parsed.ok).toBe(false);
  });

  it('refuses on wrong format discriminator', () => {
    const bad = { ...makeValid(), format: 'something-else' };
    const parsed = parseMultisigConfig(bad as unknown);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toMatch(/not an xx-wallet multisig config/i);
    }
  });

  it('refuses on a future version it cannot understand', () => {
    const bad = { ...makeValid(), version: 99 };
    const parsed = parseMultisigConfig(bad as unknown);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toMatch(/version/i);
    }
  });

  it('refuses on swapped signer (the central security check)', () => {
    // Same threshold + multisigAddress, but one signer replaced with a
    // different valid address. This is the canonical attack: a
    // malicious sender tries to smuggle their own address into the
    // signer set under the cover of a familiar multisig address.
    // Address derivation now mismatches → refuse.
    const tampered = {
      ...makeValid(),
      signers: [
        OTHER_SIGNER, // replaces FOUNDATION_SIGNERS[0]
        ...FOUNDATION_SIGNERS.slice(1),
      ],
    };
    const parsed = parseMultisigConfig(tampered as unknown);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toMatch(
        /multisigAddress.*does not match.*derives/i
      );
    }
  });

  it('refuses on changed threshold (keeps signer set, breaks the address derivation)', () => {
    const tampered = { ...makeValid(), threshold: 3 };
    const parsed = parseMultisigConfig(tampered as unknown);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toMatch(/derives/i);
    }
  });

  it('refuses on invalid multisigAddress', () => {
    const bad = { ...makeValid(), multisigAddress: 'not-real' };
    const parsed = parseMultisigConfig(bad as unknown);
    expect(parsed.ok).toBe(false);
  });

  it('refuses on Polkadot-format address (wrong SS58 prefix) for any field', () => {
    const polkadotAddress = '15nPkPKt4VCmtjEsLebqEbHi7nQ4eQpmgXRTsxaeoojbE2nQ';
    const bad = { ...makeValid(), multisigAddress: polkadotAddress };
    const parsed = parseMultisigConfig(bad as unknown);
    expect(parsed.ok).toBe(false);
  });

  it('refuses on threshold not an integer', () => {
    const bad = { ...makeValid(), threshold: 1.5 };
    const parsed = parseMultisigConfig(bad as unknown);
    expect(parsed.ok).toBe(false);
  });

  it('refuses on fewer than 2 signers', () => {
    const bad = { ...makeValid(), signers: [FOUNDATION_SIGNERS[0]] };
    const parsed = parseMultisigConfig(bad as unknown);
    expect(parsed.ok).toBe(false);
  });

  it('refuses on threshold exceeding signer count', () => {
    const bad = { ...makeValid(), threshold: 99 };
    const parsed = parseMultisigConfig(bad as unknown);
    expect(parsed.ok).toBe(false);
  });

  it('refuses on garbage non-object input', () => {
    expect(parseMultisigConfig('not json').ok).toBe(false);
    expect(parseMultisigConfig(null).ok).toBe(false);
    expect(parseMultisigConfig(undefined).ok).toBe(false);
    expect(parseMultisigConfig(42).ok).toBe(false);
    expect(parseMultisigConfig([]).ok).toBe(false);
  });

  it('refuses on invalid createdBy if present', () => {
    const bad = { ...makeValid(), createdBy: 'not-real' };
    const parsed = parseMultisigConfig(bad as unknown);
    expect(parsed.ok).toBe(false);
  });
});

describe('parseMultisigConfig — equivalence: a config built for ANY multisig validates', () => {
  // Sanity: prove the validator isn't accidentally pinned to the
  // foundation example. Build a config for a synthetic 3-of-3, parse
  // it, expect ok.
  it('handles a 3-of-3 synthetic config end-to-end', () => {
    const signers = FOUNDATION_SIGNERS.slice(0, 3);
    const address = deriveMultisigAddress(3, signers);
    const cfg = buildMultisigConfig({
      multisigAddress: address,
      threshold: 3,
      signers,
    });
    const parsed = parseMultisigConfig(serializeMultisigConfig(cfg));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config.multisigAddress).toBe(address);
      expect(parsed.config.threshold).toBe(3);
    }
  });
});
