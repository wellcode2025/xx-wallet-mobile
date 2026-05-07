/**
 * xx network address utilities.
 *
 * xx addresses use SS58 encoding with prefix 55 — they always start with "6".
 * Example: 6WSH4iFzYY3ATabSuQwSaaacFLs9JVAhH7R3xAFf1UyWoEsH
 */

import { decodeAddress, encodeAddress, isAddress } from '@polkadot/util-crypto';
import { XX_SS58_PREFIX } from '../api/constants';

/**
 * Check if a string is a valid xx network address.
 * Returns true only if the address decodes AND has the xx SS58 prefix.
 */
export function isValidXxAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;

  // Quick check: xx addresses always start with "6"
  if (!address.startsWith('6')) return false;

  try {
    // isAddress checks basic SS58 structure
    if (!isAddress(address)) return false;

    // Re-encode with the xx prefix and compare — if they match,
    // the address was already in xx format (not another Substrate chain)
    const decoded = decodeAddress(address);
    const reencoded = encodeAddress(decoded, XX_SS58_PREFIX);
    return reencoded === address;
  } catch {
    return false;
  }
}

/**
 * Convert an address from another Substrate chain to xx format.
 * Returns null if the input is not a valid Substrate address at all.
 *
 * Useful when a user pastes a Polkadot/Kusama address — we can show them
 * the equivalent xx-formatted version.
 */
export function toXxAddress(address: string): string | null {
  try {
    const decoded = decodeAddress(address);
    return encodeAddress(decoded, XX_SS58_PREFIX);
  } catch {
    return null;
  }
}

/**
 * Shorten an address for compact display.
 *
 * @example
 *   shortenAddress('6WSH4iFzYY3ATabSuQwSaaacFLs9JVAhH7R3xAFf1UyWoEsH')
 *   // -> "6WSH4…oEsH"
 */
export function shortenAddress(
  address: string,
  opts: { start?: number; end?: number } = {}
): string {
  const { start = 5, end = 4 } = opts;
  if (!address || address.length <= start + end + 1) return address;
  return `${address.slice(0, start)}…${address.slice(-end)}`;
}
