/**
 * XX Network chain type registrations.
 *
 * The xx network blockchain is Substrate-based but includes custom pallets
 * (notably xxCustody, xxCmix, staking overrides) that require type registration
 * for @polkadot/api to decode chain data correctly.
 *
 * These mirror the types defined in wallet.xx.network's
 * `packages/apps-config/src/api/typesBundle.ts`.
 *
 * For Phase 1 we register the minimum needed for balances and transfers.
 * Additional types for staking, governance, and custody will be added as we
 * build out each feature in later phases.
 */

import type { OverrideBundleDefinition } from '@polkadot/types/types';

// Minimal type bundle for Phase 1 — balances and transfers work without
// custom types, but we register the chain identity so the API knows it's xx.
export const xxTypes: OverrideBundleDefinition = {
  types: [
    {
      // All versions — Phase 1 doesn't need version-specific overrides.
      minmax: [0, undefined],
      types: {
        // Placeholder — xx network currently uses standard Substrate types
        // for basic balance/transfer operations. Custom types for xxCmix and
        // xxCustody are added in later phases.
      },
    },
  ],
};

/**
 * Chain metadata hint. Passed to ApiPromise so it knows the network identity
 * even before the first block is received — useful for address formatting.
 */
export const xxChainProperties = {
  ss58Format: 55,
  tokenDecimals: [9],
  tokenSymbol: ['XX'],
};
