# ADR-0013: Service-worker updates via user prompt; no version pin or bundle signature (accepted risk)

- Status: accepted (retroactive capture; documented in SECURITY.md deployment trust model)
- Date: 2026-07-08
- Tier: T1
- Review: independent

## Context

A browser-served wallet's code arrives from its hosting chain (GitHub repo → Cloudflare → DNS) on every visit. Nothing in web-platform PWAs verifies that today's bundle is the one the developer intended: there is no signature check and no version pinning. Every browser wallet shares this; the question is only how honestly to handle updates within it.

## Decision

The service worker registers with `registerType: 'prompt'`: new versions download in the background but activate **only when the user taps Update** in the in-app banner — no silent code swap mid-session. This is a UX/state-preservation safeguard, explicitly **not** a security control, and SECURITY.md says so plainly: a user tapping Update against a compromised deployment runs the replaced code. The compensating controls are structural — hosting on xx Foundation infrastructure (same trust surface as the official wallet), and the standing advice that material balances belong on hardware or multisig, treating any browser wallet as a hot wallet.

## Alternatives considered

- **Silent auto-update:** rejected — mid-session code swaps in a signing app, and users lose even the awareness of a change. (Known iOS cost: installed PWAs can sit on old versions until force-quit; an update banner wired to `useRegisterSW` is the open follow-up.)
- **Bundle signing / version pinning in the SW:** investigated; the verifier itself arrives from the same origin it verifies, so it adds complexity without changing the trust root. Honest documentation beats theater.

## Consequences

The trust model is stated where researchers will look, rather than implied. Deploy access (`push` to `main`, the Cloudflare account, DNS) *is* the security boundary — which elevates the deploy pipeline into the T2 list and motivates the beta→main promotion gate.

## Reversibility

Update mechanics are freely changeable. The honest-documentation stance is the part to preserve: any future claim of update security must be technically real.
