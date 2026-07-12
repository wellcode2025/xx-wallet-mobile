# ADR-0006: Dedicated messaging passphrase; a memo is transport, never instruction

- Status: accepted (retroactive capture, decisions made 2026-06)
- Date: 2026-07-08
- Tier: T2
- Review: independent

## Context

Two separable decisions that together define messaging's trust posture, captured jointly because they answer the same question: what does messaging get to touch?

1. The cMix storage (all reception identities) needs an at-rest secret. Reusing a wallet-account password would couple a comms credential to a fund credential.
2. Multisig coordination memos deliver call data over the mixnet. A sender could try to make the delivered payload *mean* something on the approval surface.

## Decision

1. **Dedicated messaging passphrase**, separate from every wallet-account password. One storage secret is scrypt-wrapped (N=131072) under it; "stay enabled on this device" adds a non-extractable device-key wrap on top. The passphrase is an access credential for a self-contained, portable comms identity — never a signing factor (consistent with ADR-0004).
2. **Memo is transport, never instruction.** A cMix-delivered proposal payload is cached as pending bytes and then re-validated against the on-chain call hash exactly like a pasted or QR'd bytes-package (ADR-0002). Nothing delivered over messaging is rendered as the truth about a call; delivery ACKs (double-check) confirm receipt, not meaning.

## Alternatives considered

- **Reuse a wallet password for messaging storage:** rejected — cross-couples credentials, encourages password reuse across trust domains, and breaks the "messaging is portable and self-contained" model.
- **Trust coordination payloads from authenticated contacts:** rejected — an authenticated channel proves *who sent it*, not *what the bytes do*; the §6.4 gate stays.

## Consequences

Messaging can be enabled, backed up, restored, or abandoned without touching fund security. One more passphrase for users to hold (mitigated by the device-key "stay enabled" wrap). Coordination gains mixnet delivery with zero new trust granted to senders.

## Reversibility

The passphrase separation is structural (storage secret wrapped under it) — reversing requires a re-wrap migration. The transport-not-instruction rule is policy under ADR-0002 and inherits its bar.
