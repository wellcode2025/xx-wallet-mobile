# Architecture Decision Records

Each file records one material decision: the context, what was decided, what was rejected, and what it costs to reverse. ADRs are immutable once accepted — to change a decision, write a new ADR that supersedes the old one.

Most of these are retroactive captures (2026-07-11 brownfield audit, Stage 2) of decisions made earlier in the project; the decision dates are noted inside each record.

| ADR | Title | Tier |
|-----|-------|------|
| [0001](0001-scrypt-keystore-compat.md) | Keystore KDF pinned to scrypt N=131072 for official-wallet compatibility | T2 |
| [0002](0002-decode-from-bytes-invariant.md) | Decode-from-bytes is the approval-surface invariant (THE RULE, facet 1) | T2 |
| [0003](0003-keyring-isolation.md) | Key material is confined to `src/keyring/` (THE RULE, facet 2) | T2 |
| [0004](0004-no-biometric-to-sign.md) | No biometric-to-sign; fund 2FA must be chain-enforced; app lock is access-gate-only | T2 |
| [0005](0005-per-account-cmix-identities.md) | One cMix identity per wallet account; fixed sender identity per thread | T2 |
| [0006](0006-messaging-passphrase-and-memo-transport.md) | Dedicated messaging passphrase; a memo is transport, never instruction | T2 |
| [0007](0007-signed-contact-bindings.md) | Contacts are account-signed bindings; auto-confirm only known contacts by reception ID | T1 |
| [0008](0008-cold-resume-ordering-contract.md) | Cold-resume ordering — identities and listeners before the follower starts | T1 |
| [0009](0009-transferkeepalive-and-ed-aware-max.md) | `transferKeepAlive` everywhere; ED read from chain; ED-aware Max | T1 |
| [0010](0010-indexer-untrusted-narrator.md) | The indexer is an untrusted narrator; chain-first reads; privacy toggle at a single gate | T1 |
| [0011](0011-ledger-transport-and-display-limits.md) | Ledger — WebHID/WebUSB only; refuse what the device can't display | T2 |
| [0012](0012-xx-codec-conventions.md) | xx v206 codec conventions — enums via `toJSON`, named fields, mangle guards | T1 |
| [0013](0013-sw-update-prompt-trust-model.md) | Service-worker updates via user prompt; no version pin (accepted risk) | T1 |
| [0014](0014-web-platform-header-posture.md) | Deliberate web-platform posture — CSP/HSTS, public sourcemaps, same-origin WASM | T2 |
| [0015](0015-warn-and-acknowledge-over-hard-blocks.md) | Risk-to-self gets warn + acknowledge; only integrity violations get hard blocks | T1 |
| [0016](0016-beta-main-release-channels.md) | Two release channels — beta auto-deploys; main is PR-only behind required CI | T2 |
