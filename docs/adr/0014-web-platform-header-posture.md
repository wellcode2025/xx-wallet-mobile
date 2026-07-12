# ADR-0014: Deliberate web-platform posture — CSP/HSTS choices, public sourcemaps, same-origin WASM (audit #1 dispositions)

- Status: accepted (retroactive capture; decisions made 2026-05 → 06-13, most during the 2026-06-12 security-audit remediation)
- Date: 2026-07-11
- Tier: T2
- Review: independent (external security audit #1: 6 Low + 4 Info, no Crit/High/Med; per-finding dispositions committed 78374aa…20506ff)

## Context

For a browser-served wallet, the response headers and build artifacts *are* part of the security posture. The first external security audit (2026-06-12) forced each implicit choice into an explicit accept-or-fix disposition; several "accepts" are deliberate trade-offs that look like oversights unless recorded.

## Decision

The posture, each part intentional:

- **CSP `default-src 'self'`** with a deliberate **`wss://*` wildcard** in `connect-src`: users may configure custom RPC endpoints, so the WebSocket host set cannot be enumerated in a static header. Accepted with an explanatory comment in `public/_headers`. Remote plaintext `ws://` is rejected by the Settings validator (localhost only).
- **HSTS 2 years + `includeSubDomains`, `preload` deliberately omitted**: preloading would force HTTPS on every `*.xx.network` subdomain browser-side and is effectively irreversible; not until a subdomain audit confirms readiness.
- **Sourcemaps published**: for an open-source wallet, letting anyone map served code back to the public source is transparency, not leakage. Accepted with comment.
- **xxdk WASM served same-origin** (proxied) rather than widening `script-src` to a third-party origin; cMix infra (`*.xxnode.io`, `*.cmix.rip`) is allowlisted in `connect-src` only.
- **Permissions-Policy default-deny**: everything off except `camera=(self)` (QR scanner) and `usb=(self), hid=(self)` (Ledger, ADR-0011) — a compromised dependency can't quietly start the mic or read location.
- **Imported-keystore scrypt bounds** N≤262144, r≤8, p≤4 (memory-exhaustion DoS, with tests) — the import-side complement to ADR-0001.

## Alternatives considered

- **Enumerated `connect-src` hosts:** rejected — breaks the custom-RPC feature; the wildcard is scheme-restricted to `wss:`.
- **HSTS preload now:** rejected as irreversible without evidence of subdomain readiness.
- **Hidden sourcemaps:** rejected — obscurity with real debugging cost, zero secrecy gain for a public repo.

## Consequences

`public/_headers` is load-bearing and sits in the T2 tier: new device APIs, script origins, or connect targets must be argued against this posture, not just appended. The audit trail (finding IDs in commit messages) makes dispositions checkable.

## Reversibility

Each line is independently revisable except HSTS preload (browser-side, months to undo) — which is exactly why it's the one thing deliberately *not* enabled.
