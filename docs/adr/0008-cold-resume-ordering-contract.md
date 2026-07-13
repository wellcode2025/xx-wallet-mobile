# ADR-0008: Cold-resume ordering — identities log in and listeners pre-register before the follower starts

- Status: accepted (decision made 2026-07-07, verified on-device)
- Date: 2026-07-11
- Tier: T1
- Review: independent (root cause proven in isolated spikes; fix T5-verified on-device)

## Context

Messages sent while a recipient's app was fully closed were lost on next open. The failure was a two-layer race in cold resume, proven in scratch spikes: (1) if the network follower starts before an identity's e2e Login registers its fingerprints, the first retrieval can't match the message; (2) even with fingerprints in place, if app-level listeners aren't registered when `handleMessage` fires, the message "didn't match any listeners", the round is marked checked, and the message is permanently dropped — cMix does not re-deliver a checked round.

## Decision

The session layer exposes a `beforeFollower` seam, and messaging uses it to complete **eager e2e Logins for all known identities** and to **pre-register buffering listener slots** (per known sender × message type, keyed by reception-ID hex) *before* `StartNetworkFollower` is called. Buffered slots queue anything heard before a real handler attaches, then drain on attach. Pre-registration derives its sender list from the contacts registry — which is keyed by the *partner's* account. Sender-side, a re-send backstop retries un-acked memos every 45s (7-day cap) while online; receivers dedup by memo id.

## Alternatives considered

- **Fork the client / expose `AddIdentityWithHistory`:** the original plan; unnecessary for ≤24h gaps once the wallet-side races were fixed. Remains the only path for a >24h lookback (open follow-up).
- **Lazy Logins on first use (status quo ante):** rejected — loses first-retrieval messages irrecoverably.
- **Sender-side retry alone:** insufficient — masks the race only while the sender stays online; kept as defence-in-depth, not the fix.

## Consequences

Offline→cold-open delivery works (~4s observed) with stock xxdk-wasm, sender offline throughout. Costs: eager Logins add cold-start work proportional to account count; the ordering contract is now load-bearing — any refactor of session startup must preserve *Logins + listener slots before follower*, which is exactly the kind of invariant that dies in refactors unless written down. Hence this ADR.

## Reversibility

Mechanically trivial to break, so treat the ordering as a named contract: changes to `session.ts` / `messaging.ts` startup order are T1 and must re-verify the T5 cold-resume scenario.
