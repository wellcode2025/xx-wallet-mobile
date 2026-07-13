# ADR-0007: Contacts are account-signed bindings; auto-confirm only known contacts, matched by reception ID

- Status: accepted (retroactive capture, decisions made 2026-06 → 07-01)
- Date: 2026-07-11
- Tier: T1
- Review: independent

## Context

A cMix contact blob by itself proves nothing about who owns it — anyone could hand you an identity and claim it belongs to a treasury cosigner. Impersonation at contact-exchange time would poison every later coordination flow. Separately, incoming channel requests arrive from arbitrary identities, and marshalled contact bytes for the *same* contact differ across forms, so raw-byte comparison is unsound.

## Decision

A contact is an **account-signed binding**: the wallet verifies that the claimed wallet account's key actually signed the (account ⟷ cMix identity) binding before storing it; tampered or unsigned bindings are rejected. Incoming channel requests are auto-confirmed **only** when the requester matches a known contact, matched by canonical reception ID (`GetIDFromContact`), never by raw contact bytes. Messaging is two-way by design: both parties add each other's contact; there is no one-way path. Contact display always pairs the name with a truncated SS58 address fragment (design §7.3 — substitution must never hide identity).

## Alternatives considered

- **TOFU (trust the first blob):** rejected — impersonation at first contact is the main threat in coordination flows involving funds.
- **Auto-confirm any incoming request:** rejected — spam and impersonation vector; the known-contact gate is the anti-impersonation line.
- **Raw-byte contact comparison:** rejected as *incorrect* — same contact marshals differently across forms; caused real matching failures until replaced with reception-ID matching.

## Consequences

Contact exchange costs one extra step (both directions) but every stored contact carries a cryptographic account linkage — which multisig coordination then relies on. The two-way handshake gate blocks the composer until a channel exists, trading a little friction for no silent one-way sends.

## Reversibility

Straightforward to extend (e.g., richer verification), costly to loosen: weakening the binding check or the known-contact gate reopens impersonation and needs a superseding ADR.
