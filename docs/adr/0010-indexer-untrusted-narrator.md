# ADR-0010: The indexer is an untrusted narrator; chain-first reads; privacy toggle at a single gate

- Status: accepted (retroactive capture, decisions made 2026-05 → 06)
- Date: 2026-07-11
- Tier: T1
- Review: independent

## Context

The xxfoundation indexer enriches the wallet (history, rewards, identity names, multisig scan) but is a third-party service: it can lie, go stale, or observe which addresses a user asks about from which IP. During development its staking data was observed 255+ eras stale and parts of its infrastructure degraded — trusting it for anything funds-adjacent was empirically unsafe, not just theoretically.

## Decision

Three rules. (1) **The indexer never gets authority over money or approvals**: nothing funds-related depends on it; approval surfaces decode from chain-verified bytes (ADR-0002); staking and governance views read the chain first and use the indexer only to enrich. (2) **Indexer output is data, never code or narrative-of-record**: rendered through React escaping, cross-checked where it matters (e.g., multisig scan results re-derive addresses locally). (3) **A Settings → Privacy toggle disables all indexer traffic**, enforced at a single local gate every indexer query flows through — so no code path can leak when it's off; affected views state what's unavailable and why, and identity lookups fall back to direct chain RPC.

## Alternatives considered

- **Indexer-first views (faster, richer):** rejected after staleness findings; chain-first costs some latency but can't be lied to about state.
- **Per-feature privacy toggles:** rejected — N gates means N leak opportunities; one chokepoint is auditable.
- **No indexer at all:** rejected — history and identity enrichment are real UX value; the right posture is bounded trust, clearly disclosed (SECURITY.md).

## Consequences

The wallet works fully — funds-wise — with the indexer down or disabled. New features that want indexer data must route through the single gate and degrade gracefully. Users get an honest, binary privacy control.

## Reversibility

The single-gate architecture is easy to keep, hard to retrofit. New indexer call sites bypassing the gate are boundary violations (T1).
