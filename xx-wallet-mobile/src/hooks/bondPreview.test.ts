/**
 * Tests for the treasury bond + bounty deposit math.
 *
 * Spike-observed constants from xx v206:
 *   proposalBondPerMill = 50_000 (5%)
 *   proposalBondMinimum = 100 XX  (100_000_000_000 planck)
 *   proposalBondMaximum = 500 XX  (500_000_000_000 planck)
 *   bountyDepositBase   = 1 XX
 *   dataDepositPerByte  = 0.01 XX
 *
 * 1 XX = 1_000_000_000 planck (9 decimals).
 */

import { describe, expect, it } from 'vitest';
import { BN } from '@polkadot/util';
import {
  bountyDeposit,
  treasuryBond,
  utf8ByteLength,
} from './bondPreview';

// bn.js's `muln` asserts multiplier < 2^26 (≈67M); 1 billion overflows
// that, so use `.mul(new BN(...))` for the planck conversion.
const PLANCK_PER_XX = new BN(1_000_000_000);
const XX = (n: number | string) => new BN(`${n}`).mul(PLANCK_PER_XX);

const TREASURY_DEFAULTS = {
  bondPerMill: 50_000, // 5%
  bondMinimum: XX(100),
  bondMaximum: XX(500),
};

describe('treasuryBond — value below minimum', () => {
  it('5% of 100 XX is 5 XX → clamps up to bondMinimum (100 XX)', () => {
    const bond = treasuryBond({
      value: XX(100),
      ...TREASURY_DEFAULTS,
    });
    expect(bond.toString()).toBe(XX(100).toString());
  });

  it('5% of 1,000 XX is 50 XX → still clamps to 100 XX min', () => {
    expect(
      treasuryBond({ value: XX(1_000), ...TREASURY_DEFAULTS }).toString()
    ).toBe(XX(100).toString());
  });
});

describe('treasuryBond — value in the linear band', () => {
  it('5% of 4,000 XX = 200 XX (between min and max)', () => {
    expect(
      treasuryBond({ value: XX(4_000), ...TREASURY_DEFAULTS }).toString()
    ).toBe(XX(200).toString());
  });

  it('5% of 10,000 XX = 500 XX (right at the max)', () => {
    expect(
      treasuryBond({ value: XX(10_000), ...TREASURY_DEFAULTS }).toString()
    ).toBe(XX(500).toString());
  });
});

describe('treasuryBond — value above max', () => {
  it('5% of 1,000,000 XX would be 50,000 XX → caps at 500 XX max', () => {
    expect(
      treasuryBond({ value: XX(1_000_000), ...TREASURY_DEFAULTS }).toString()
    ).toBe(XX(500).toString());
  });
});

describe('treasuryBond — uncapped max (Option::None)', () => {
  it('5% of 1,000,000 XX with no max = 50,000 XX', () => {
    expect(
      treasuryBond({
        value: XX(1_000_000),
        bondPerMill: 50_000,
        bondMinimum: XX(100),
        bondMaximum: null,
      }).toString()
    ).toBe(XX(50_000).toString());
  });
});

describe('bountyDeposit', () => {
  const BASE = XX(1);
  const PER_BYTE = new BN(10_000_000); // 0.01 XX

  it('empty description = base alone', () => {
    expect(
      bountyDeposit({
        descriptionBytes: 0,
        depositBase: BASE,
        dataDepositPerByte: PER_BYTE,
      }).toString()
    ).toBe(BASE.toString());
  });

  it('100 bytes = base + 100 × 0.01 XX = 1 + 1 = 2 XX', () => {
    expect(
      bountyDeposit({
        descriptionBytes: 100,
        depositBase: BASE,
        dataDepositPerByte: PER_BYTE,
      }).toString()
    ).toBe(XX(2).toString());
  });

  it('1,000 bytes = base + 10 XX = 11 XX', () => {
    expect(
      bountyDeposit({
        descriptionBytes: 1_000,
        depositBase: BASE,
        dataDepositPerByte: PER_BYTE,
      }).toString()
    ).toBe(XX(11).toString());
  });
});

describe('utf8ByteLength', () => {
  it('ASCII string: bytes = chars', () => {
    expect(utf8ByteLength('xxG-2025-01-MoveForChange')).toBe(25);
  });

  it('counts the 2-byte em-dash correctly', () => {
    // "—" is U+2014, 3 bytes in UTF-8.
    expect(utf8ByteLength('—')).toBe(3);
  });

  it('counts the 4-byte emoji correctly', () => {
    // "🇵🇹" is two regional-indicator code points, 8 bytes total in UTF-8.
    expect(utf8ByteLength('🇵🇹')).toBe(8);
  });

  it('counts an empty string as zero', () => {
    expect(utf8ByteLength('')).toBe(0);
  });
});
