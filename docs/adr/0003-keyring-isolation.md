# ADR-0003: Key material is confined to src/keyring/ (THE RULE, facet 2)

- Status: accepted (retroactive capture; practiced since project start, formalized 2026-07-11)
- Date: 2026-07-11
- Tier: T2
- Review: independent

## Context

A browser wallet's worst failure is key material leaking into code paths that were never reviewed as key-handling code. The natural drift in a growing codebase is for screens and hooks to import keyring primitives directly "just this once."

## Decision

All key generation, keystore encryption/decryption, unlocking, and signing-key access live in `src/keyring/`. No module outside it imports `@polkadot/keyring` or handles decrypted key bytes. Everything else interacts with keys through the keyring store's API (and the `useTx` signing hooks layered on it). Supporting properties enforced inside the boundary: intermediate decrypted PKCS8 buffers are zeroed in `finally` blocks and pairs are re-locked immediately after signing (H-2, best-effort in JS); Ledger accounts extend the same boundary — `source: 'local' | 'ledger'` discriminated union, and a Ledger record holds no key material at all, so every account⇒keystore assumption branches on `source`.

## Alternatives considered

- **Convention only, no stated boundary:** rejected — this is exactly what erodes; it must be a named rule with a mechanical gate (grep-level boundary check, Stage 3).
- **A separate signing web-worker/iframe origin:** considered for the future; heavier isolation with real benefits, but not required to state the boundary now and doesn't replace it.

## Consequences

New signing features route through existing keyring APIs or extend `src/keyring/` itself (T2 either way). The boundary makes audit scope crisp: key-handling review = one directory plus the signing hooks. Crossing the boundary anywhere else makes a change T1 minimum by definition.

## Reversibility

The boundary is cheap to keep and costly to re-establish once eroded. Individual violations are easy to fix when caught early — which is the boundary gate's job.
