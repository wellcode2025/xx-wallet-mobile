/**
 * xx network blockchain constants.
 *
 * Source: https://github.com/xxfoundation/exchange-integration (README)
 *
 * These values are baked into the chain and must never change without
 * the xx network itself changing. Do not alter without consulting Rick.
 */

/** SS58 prefix for xx network addresses — all xx addresses start with "6". */
export const XX_SS58_PREFIX = 55;

/** Number of decimal places for XX balances. */
export const XX_DECIMALS = 9;

/** Currency ticker shown in the UI. */
export const XX_SYMBOL = 'XX';

/** Full currency name. */
export const XX_NAME = 'xx network';

/** Target block time in milliseconds. */
export const XX_BLOCK_TIME_MS = 6000;

/** Blocks until a transaction is considered final (roughly 18 seconds). */
export const XX_FINALITY_BLOCKS = 3;

/**
 * Public RPC endpoints, ordered by preference.
 * The app will try these in order if one fails.
 */
export const XX_ENDPOINTS = [
  {
    name: 'xx foundation',
    url: 'wss://rpc.xx.network',
    isDefault: true,
  },
  {
    name: 'Dwellir',
    url: 'wss://xx-network-rpc.dwellir.com',
    isDefault: false,
  },
] as const;

export const DEFAULT_ENDPOINT = XX_ENDPOINTS[0].url;
