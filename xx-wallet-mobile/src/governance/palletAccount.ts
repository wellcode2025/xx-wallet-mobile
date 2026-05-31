/**
 * Pallet-account derivation — substrate `PalletId::into_account_truncating`.
 *
 * Substrate's runtime computes a deterministic AccountId for each pallet
 * by concatenating `"modl"` (4 bytes) + the 8-byte `PalletId` + zero-pad
 * to 32 bytes, then encoding as an AccountId32. The treasury, bounties,
 * tips, and child-bounties pallets all hold their funds at addresses
 * derived this way.
 *
 * We use this to compute the xx treasury address from
 * `api.consts.treasury.palletId` so we can query its balance via
 * `system.account(treasuryAddr)`. The treasury pallet itself doesn't
 * expose its account anywhere directly — it has to be derived.
 *
 * Pure function. No chain calls, no React. Tested against the known
 * Polkadot treasury account as a cross-chain sanity fixture.
 */

import { stringToU8a } from '@polkadot/util';
import { encodeAddress } from '@polkadot/util-crypto';
import { XX_SS58_PREFIX } from '@/api/constants';

const MODL_PREFIX = stringToU8a('modl');
const ACCOUNT_BYTES = 32;

/**
 * Derive the SS58 address of a pallet's module account.
 *
 * @param palletId 8-byte PalletId, typically read from
 *                 `api.consts.<pallet>.palletId` (which returns a Bytes codec —
 *                 call `.toU8a()` first).
 * @param ss58Prefix Network SS58 prefix. Defaults to xx (55).
 */
export function deriveModuleAccount(
  palletId: Uint8Array,
  ss58Prefix: number = XX_SS58_PREFIX
): string {
  if (palletId.length !== 8) {
    throw new Error(
      `deriveModuleAccount: palletId must be 8 bytes, got ${palletId.length}`
    );
  }
  const acc = new Uint8Array(ACCOUNT_BYTES);
  acc.set(MODL_PREFIX, 0);     // bytes  0–3: "modl"
  acc.set(palletId, 4);        // bytes  4–11: palletId
  // bytes 12–31 remain zero per into_account_truncating
  return encodeAddress(acc, ss58Prefix);
}
