# ADR-0005: One cMix identity per wallet account; fixed sender identity per thread

- Status: accepted (retroactive capture, decision made 2026-06)
- Date: 2026-07-11
- Tier: T2
- Review: independent

## Context

Wallet accounts are unlinkable on-chain by design; users maintain separate accounts precisely to keep contexts separate. A single shared messaging identity would let any two counterparties correlate all of a user's accounts the moment both had talked to them — messaging would silently undo the chain's privacy model.

## Decision

Each wallet account gets its **own** cMix reception identity ("Option C"). One cMix client and one network follower host all of them (N e2e Logins on one follower). A conversation is a thread keyed `(myAccount, partner)`; the sender identity of a thread is **fixed at creation and never switched in place** — switching would merge two unlinkable identities in the partner's view. Reaching the same partner from a different account is deliberately a separate thread on both ends. Identities are stored per-account in the EKV; a cMix identity is device-created (no seed derivation), so portability is via encrypted backup (`.xxid`, all identities under one passphrase) rather than re-derivation.

## Alternatives considered

- **One messaging identity per wallet (simple, Haven-like):** rejected — links all accounts through messaging metadata.
- **Fresh identity per conversation:** rejected — contact-exchange overhead explodes and multisig coordination needs stable per-signer identities.
- **Seed-derived identities for free portability:** not possible — xxdk creates identities device-side; backup/restore is the portability path.

## Consequences

Messaging respects account unlinkability; multisig coordination rides the correct per-signer identity automatically. Costs: N Logins on one client (cold-resume ordering matters — ADR-0008), a "Messaging as [account]" concept users must see, and account-scoped contact bindings (ADR-0007).

## Reversibility

Hard to reverse socially: collapsing identities after the fact reveals the linkage the model existed to prevent. Treat the identity model as fixed; extensions (new account types) must preserve per-account separation.
