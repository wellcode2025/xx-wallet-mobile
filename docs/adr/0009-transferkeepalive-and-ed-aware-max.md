# ADR-0009: transferKeepAlive everywhere; existential deposit read from chain; ED-aware Max

- Status: accepted (retroactive capture; ED fix shipped 2026-06-30 → 07-01)
- Date: 2026-07-08
- Tier: T1
- Review: independent

## Context

Substrate reaps accounts that drop below the existential deposit, silently destroying the remainder. Separately, a "Max" button computed against a wrong ED produces on-chain failures: the wallet originally hardcoded ED = 0.001 XX, which is wrong for xx network — Max sends failed with `balances.InsufficientBalance`.

## Decision

Transfers use `transferKeepAlive`, so a sender cannot accidentally reap their own account, and the wallet warns when a recipient would receive less than the ED (account-creation risk). The ED is **read from `api.consts.balances.existentialDeposit` at runtime — never hardcoded**. Max is computed per flow to match who actually pays the fee: regular send Max = transferable − ED − estimated fee (via `paymentInfo`); multisig-propose Max = transferable − ED only, because the proposing *signer* pays the fee (and deposit) from their own account. The same fact powers the multisig pre-flight check: signers are warned to keep ≈5 XX for fees/deposits.

## Alternatives considered

- **`transfer` (allow-death) with a warning:** rejected — silent value destruction is not a user-consentable footgun in a mobile wallet.
- **Hardcoding the correct ED:** rejected — chain constants can change with runtime upgrades; the original bug was exactly a hardcode gone stale.

## Consequences

Max works reliably; a class of "why did my send fail" reports disappears. Chain-baked values that *must* stay static (SS58, decimals, genesis hash) remain in `api/constants.ts` under the hard-rule regime — the line is: identity-defining constants are pinned, economic parameters are read live.

## Reversibility

Trivial code-wise; the pinned-vs-live line above is the part to preserve in review.
