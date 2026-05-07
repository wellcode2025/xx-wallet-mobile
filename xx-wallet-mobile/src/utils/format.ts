/**
 * XX balance formatting.
 *
 * The chain stores balances in the smallest unit (1 XX = 10^9 planck-equivalents).
 * These helpers convert between the raw BN/bigint stored on-chain and
 * human-readable strings.
 *
 * We use BigNumber.js rather than bigint because it handles decimal display
 * cleanly and is already a dependency of many crypto libraries.
 */

import BigNumber from 'bignumber.js';
import type { BN } from '@polkadot/util';
import { XX_DECIMALS, XX_SYMBOL } from '../api/constants';

// Configure BigNumber once — we never want scientific notation in a wallet.
BigNumber.config({
  EXPONENTIAL_AT: [-18, 18],
  DECIMAL_PLACES: 18,
});

const DIVISOR = new BigNumber(10).pow(XX_DECIMALS);

export interface FormatOptions {
  /** Number of decimal places to show. Default 4. */
  decimals?: number;
  /** Trim trailing zeros. Default true. */
  trim?: boolean;
  /** Include the XX symbol. Default false. */
  withSymbol?: boolean;
  /** Group digits with thousand separators. Default true. */
  grouping?: boolean;
}

/**
 * Format a raw balance (BN or bigint, in planck units) as a human string.
 *
 * @example
 *   formatBalance(new BN('1500000000'))        // "1.5"
 *   formatBalance(new BN('1500000000'), { withSymbol: true })  // "1.5 XX"
 *   formatBalance(new BN('0'))                 // "0"
 */
export function formatBalance(
  raw: BN | bigint | string | null | undefined,
  opts: FormatOptions = {}
): string {
  if (raw === null || raw === undefined) return '—';

  const { decimals = 4, trim = true, withSymbol = false, grouping = true } = opts;

  const asString =
    typeof raw === 'bigint'
      ? raw.toString()
      : typeof raw === 'string'
      ? raw
      : raw.toString();

  const bn = new BigNumber(asString).div(DIVISOR);
  let formatted = bn.toFixed(decimals);

  if (trim && formatted.includes('.')) {
    formatted = formatted.replace(/\.?0+$/, '');
    if (formatted === '' || formatted === '-') formatted = '0';
  }

  if (grouping) {
    const [intPart, fracPart] = formatted.split('.');
    const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    formatted = fracPart ? `${groupedInt}.${fracPart}` : groupedInt;
  }

  return withSymbol ? `${formatted} ${XX_SYMBOL}` : formatted;
}

/**
 * Parse a human-entered amount string into raw planck units.
 * Used when constructing a transfer extrinsic.
 *
 * Returns null if the input is invalid (non-numeric, negative, too precise).
 */
export function parseAmount(input: string): BigNumber | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (!trimmed) return null;

  const bn = new BigNumber(trimmed);
  if (bn.isNaN() || bn.isNegative()) return null;

  // Reject values more precise than the chain allows (9 decimal places)
  const [, fracPart = ''] = trimmed.split('.');
  if (fracPart.length > XX_DECIMALS) return null;

  const raw = bn.multipliedBy(DIVISOR);
  if (!raw.isInteger()) return null;

  return raw;
}

/**
 * Format a balance for display as the "hero" number on the dashboard.
 * Splits the integer and fractional parts so we can style them differently.
 */
export function splitBalance(
  raw: BN | bigint | string | null | undefined,
  decimals = 4
): { integer: string; fraction: string } {
  const formatted = formatBalance(raw, { decimals, trim: false, grouping: true });
  const [integer, fraction = ''] = formatted.split('.');
  return { integer, fraction };
}
