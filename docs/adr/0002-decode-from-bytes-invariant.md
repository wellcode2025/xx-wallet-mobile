# ADR-0002: Decode-from-bytes is the approval-surface invariant (THE RULE, facet 1)

- Status: accepted (retroactive capture, decision made 2026-05, design doc §6.4/§7.3)
- Date: 2026-07-11
- Tier: T2
- Review: independent

## Context

In any multi-party approval flow (multisig, and later preimages and governance descriptions), the party who submits a proposal also gets to *describe* it. A malicious depositor can say "this approves a coffee" while the bytes authorize a treasury drain — the depositor-as-narrator attack. The xx chain does not store call data for pending multisigs, only the call hash, so the describing text and the executable bytes arrive by different channels.

## Decision

No signing or approval surface ever renders a description it did not decode locally from call bytes, and bytes are only accepted after their hash is recomputed and matched against the on-chain call hash. If the hash doesn't match, or the bytes don't decode, the wallet refuses to render the proposal and shows a loud error — it never falls back to supplied text. This applies identically to every transport: pasted bytes-package, QR, file, chain scan, and cMix-delivered coordination memos (the memo is transport, never instruction — see ADR-0006).

## Alternatives considered

- **Render depositor-supplied description with a warning:** rejected — a warning next to a lie still reads as the lie; users habituate.
- **Trust the indexer's decoded view:** rejected — moves the narrator role to the indexer (see ADR-0010); the wallet must be able to verify with only chain RPC.

## Consequences

Every new approval-like surface must ship with a local decoder path (this shaped the preimage decoder and governance surfaces). Cross-wallet handoff needs a bytes-package format rather than free text. Decoder correctness is security-critical, so `decodeCall` / `bytesPackage` carry unit tests and sit in the T2 tier.

The invariant extends beyond call bytes to *any* proposer-supplied content rendered by the wallet: proposer-supplied bounty/forum links are scheme-allowlisted to `http(s)` before rendering (`5f421bd`), so chain-sourced text can't smuggle `javascript:` or other active schemes onto a governance surface.

## Reversibility

Reversible in code but never in policy: weakening this invariant is a security regression, not a refactor. Any exception requires its own superseding ADR with the accepted risk stated by the Owner.
