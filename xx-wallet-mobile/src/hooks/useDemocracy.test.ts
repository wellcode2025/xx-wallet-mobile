/**
 * Tests for extractProposalHash — the proposal-wrapper unpacker.
 *
 * The democracy pallet refers to preimages via a `Bounded` enum that
 * has three variants (Legacy, Lookup, Inline), but older runtimes
 * stored a raw H256 directly. The unpacker needs to handle all of
 * those without crashing. We synthesise the relevant codec shapes
 * here rather than wire a real ApiPromise.
 */

import { describe, expect, it } from 'vitest';
import { extractProposalHash } from './useDemocracy';

const SAMPLE_HASH =
  '0xa2652f1879c182d6e9fbb97b3089e54b49698e8850e7416d15d48a28157c5ef9';

describe('extractProposalHash', () => {
  it('returns null for null / undefined', () => {
    expect(extractProposalHash(null)).toBeNull();
    expect(extractProposalHash(undefined)).toBeNull();
  });

  it('unpacks a Bounded::Legacy variant', () => {
    const codec = {
      isLegacy: true,
      isLookup: false,
      isInline: false,
      asLegacy: {
        hash_: { toHex: () => SAMPLE_HASH },
      },
    };
    expect(extractProposalHash(codec)).toBe(SAMPLE_HASH);
  });

  it('falls back to .hash if the runtime uses the un-suffixed name', () => {
    const codec = {
      isLegacy: true,
      isLookup: false,
      isInline: false,
      asLegacy: {
        hash: { toHex: () => SAMPLE_HASH },
      },
    };
    expect(extractProposalHash(codec)).toBe(SAMPLE_HASH);
  });

  it('unpacks a Bounded::Lookup variant', () => {
    const codec = {
      isLegacy: false,
      isLookup: true,
      isInline: false,
      asLookup: {
        hash_: { toHex: () => SAMPLE_HASH },
      },
    };
    expect(extractProposalHash(codec)).toBe(SAMPLE_HASH);
  });

  it('returns null for Bounded::Inline (no hash to surface)', () => {
    const codec = {
      isLegacy: false,
      isLookup: false,
      isInline: true,
      asInline: { /* inline bytes — not relevant to the test */ },
    };
    expect(extractProposalHash(codec)).toBeNull();
  });

  it('handles a bare H256 with toHex (older runtimes)', () => {
    // Direct H256 sans Bounded wrapper. The function's constructor-name
    // check looks for "H256"; we stub that on a synthetic codec.
    function H256() {}
    const codec = Object.create(H256.prototype);
    codec.toHex = () => SAMPLE_HASH;
    expect(extractProposalHash(codec)).toBe(SAMPLE_HASH);
  });

  it('falls through to a blind toHex when nothing else matches', () => {
    // Defensive fallback path — codec has neither Bounded flags nor a
    // recognised H256 constructor, but does expose toHex.
    const codec = {
      toHex: () => SAMPLE_HASH,
    };
    expect(extractProposalHash(codec)).toBe(SAMPLE_HASH);
  });

  it('returns null when nothing recognisable is on the codec', () => {
    expect(extractProposalHash({ foo: 'bar' })).toBeNull();
  });

  it('returns null instead of throwing when toHex throws', () => {
    const codec = {
      isLegacy: true,
      asLegacy: {
        hash_: {
          toHex: () => {
            throw new Error('codec deserialization failure');
          },
        },
      },
    };
    expect(extractProposalHash(codec)).toBeNull();
  });
});
