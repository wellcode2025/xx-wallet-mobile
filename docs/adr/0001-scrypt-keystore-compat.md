# ADR-0001: Keystore KDF pinned to scrypt N=131072 for official-wallet compatibility

- Status: accepted (retroactive capture, decision made 2026-05)
- Date: 2026-07-08
- Tier: T2
- Review: independent (captured in brownfield audit Stage 2; original decision validated by round-trip test vectors and audit #1)

## Context

Keystores must be portable both ways with the official `wallet.xx.network` desktop wallet, whose v3 exports use scrypt at N=131072, r=8, p=1. `@polkadot/util-crypto`'s default decrypt path assumes its own weaker default (N=32768) and cannot unlock official-wallet exports.

## Decision

All keystores are encrypted and decrypted with scrypt N=131072, r=8, p=1 (`scrypt-js`), with xsalsa20-poly1305 (`tweetnacl`) as the cipher. `src/keyring/store.ts` implements a manual scrypt decrypt (`manualScryptDecrypt`) and an **async** `unlock()` path, because the JS scrypt at this cost is too slow to run synchronously. Import accepts only v3 `scrypt` + `xsalsa20-poly1305` keystores; anything else fails closed (H-3). Scrypt parameters parsed from imported files are bounds-checked (N≤262144, r≤8, p≤4) to prevent resource-exhaustion via a malicious keystore.

Two adjacent compatibility/hardening decisions ride with this one: exports set `meta.genesisHash` to the xx mainnet genesis hash, because the official wallet rejects keystores without it as "format not supported" (verified against multiple official exports); and unlock failures return **one uniform error message regardless of cause** (`db59cf8`), so the error channel doesn't reveal which part of an unlock attempt failed.

## Alternatives considered

- **Polkadot default (N=32768):** rejected — breaks official-wallet import/export symmetry and is 4× weaker against offline brute force.
- **WASM scrypt for speed:** deferred — `scrypt-js` is fast enough on target devices, and fewer moving parts in the T2 path wins.
- **Accepting multiple keystore versions/ciphers:** rejected — parsing unexpected formats at wrong byte offsets is a classic wallet failure mode; fail closed instead.

## Consequences

Keystores exported here open in the official wallet and vice versa. Every caller of `unlock()` must `await` it — a missed `await` yields the diagnostic `Decoding [object Promise]: Invalid base58 character "[" (0x5b)`. This path is a standing hard rule in CLAUDE.md: do not modify without explicit approval.

## Reversibility

Effectively irreversible without a migration: changing KDF parameters strands every existing keystore. Any change requires a re-encryption migration flow plus dual-parameter read support, treated as T2 with test vectors against real official-wallet exports.
