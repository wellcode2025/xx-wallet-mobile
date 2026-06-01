/**
 * Tests for usePreimages.readStatus — the toJSON-based parser that
 * turns a RequestStatus codec into the typed shape the screen consumes.
 *
 * Background: an earlier version used a codec-accessor parser
 * (`.isUnrequested` / `.asUnrequested.foo`) that didn't match the xx
 * runtime — the screen rendered "No preimages on chain" despite 8 live
 * preimages on chain. The fix switched to parsing
 * `statusCodec.toJSON()` directly, since the JSON shape was already
 * proven to work (and the JSON keys are stable across polkadot-js
 * versions in a way the auto-derived accessors apparently aren't).
 *
 * Fixtures here use the exact JSON shape observed live on xx mainnet
 * at head #23,512,817.
 */

import { describe, expect, it } from 'vitest';
import { BN } from '@polkadot/util';
import { readStatus } from './usePreimages';

const DEPOSITOR_1 = '6YDEf5Q78EFHbmiJRFqfpNpiGQjMZf1Cqpy2Dmi8FRYJVTCQ';
const DEPOSITOR_2 = '6WSH4iFzYY3ATabSuQwSaaacFLs9JVAhH7R3xAFf1UyWoEsH';

/**
 * Build a stub codec whose toJSON() returns the supplied object —
 * matches what polkadot-codec does for live RequestStatus values.
 */
const codecOf = (json: unknown) => ({ toJSON: () => json });

describe('readStatus — live chain fixtures', () => {
  it('parses an Unrequested status (chain fixture: 199-byte preimage)', () => {
    // Exact JSON shape observed at head #23,512,817 for hash
    // 0x01ccfcf7f6b3...
    const codec = codecOf({
      unrequested: {
        deposit: [DEPOSITOR_1, 40_263_000_000],
        len: 199,
      },
    });
    const result = readStatus(codec);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('unrequested');
    expect(result?.length).toBe(199);
    expect(result?.count).toBe(0);
    expect(result?.depositor).toBe(DEPOSITOR_1);
    expect(result?.deposit?.toString()).toBe('40263000000');
  });

  it('parses a Requested status (chain fixture: 3,896-byte preimage)', () => {
    // Exact JSON shape observed for hash 0xa2652f1879c182...
    const codec = codecOf({
      requested: {
        deposit: [DEPOSITOR_1, 43_960_000_000],
        count: 1,
        len: 3896,
      },
    });
    const result = readStatus(codec);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('requested');
    expect(result?.length).toBe(3896);
    expect(result?.count).toBe(1);
    expect(result?.depositor).toBe(DEPOSITOR_1);
    expect(result?.deposit?.toString()).toBe('43960000000');
  });

  it('parses the 6-byte xxCmix.setAdminPermission preimage', () => {
    const codec = codecOf({
      unrequested: {
        deposit: [DEPOSITOR_2, 40_070_000_000],
        len: 6,
      },
    });
    const result = readStatus(codec);
    expect(result?.depositor).toBe(DEPOSITOR_2);
    expect(result?.length).toBe(6);
  });
});

describe('readStatus — defensive paths', () => {
  it('returns null when toJSON returns null', () => {
    expect(readStatus(codecOf(null))).toBeNull();
  });

  it('returns null when toJSON returns a string', () => {
    expect(readStatus(codecOf('something'))).toBeNull();
  });

  it('returns null when the JSON has neither unrequested nor requested keys', () => {
    expect(readStatus(codecOf({ someOtherVariant: { foo: 1 } }))).toBeNull();
  });

  it('returns null when toJSON itself throws', () => {
    const codec = {
      toJSON: () => {
        throw new Error('codec deserialization failure');
      },
    };
    expect(readStatus(codec)).toBeNull();
  });

  it('returns null when the codec is null', () => {
    expect(readStatus(null)).toBeNull();
  });

  it('handles a hex-encoded balance (large value above safe-int range)', () => {
    // Substrate balances above ~9 PB would render as 0x-hex in toJSON.
    // Synthesise one to be sure parseDeposit handles the path.
    const codec = codecOf({
      unrequested: {
        deposit: [DEPOSITOR_1, '0x10000000000000000'], // 2^64
        len: 100,
      },
    });
    const result = readStatus(codec);
    expect(result?.deposit?.toString()).toBe(new BN('10000000000000000', 16).toString());
  });

  it('handles a missing depositor tuple defensively', () => {
    const codec = codecOf({
      unrequested: {
        deposit: null,
        len: 199,
      },
    });
    const result = readStatus(codec);
    expect(result).not.toBeNull();
    expect(result?.depositor).toBe('');
    expect(result?.deposit).toBeNull();
  });

  it('reads `len` as a hex-encoded number when the runtime emits one', () => {
    const codec = codecOf({
      unrequested: {
        deposit: [DEPOSITOR_1, 1000],
        len: '0xff',
      },
    });
    const result = readStatus(codec);
    expect(result?.length).toBe(255);
  });
});
