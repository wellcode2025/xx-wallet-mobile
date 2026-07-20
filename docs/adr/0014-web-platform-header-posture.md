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

## Amendment (2026-07-17) — `script-src blob:` accepted for the xxdk-wasm worker bootstrap (AUDIT-2026-07-001)

The cMix messaging build (2026-06) widened `script-src` to `'self' 'wasm-unsafe-eval' blob:` without arguing it against this posture — exactly the drift the Consequences section warned about. Audit #2 flagged it; this amendment closes it with an explicit accept.

**Why it's required.** `xxdk-wasm`'s bootstrap (dist/bundle.js) fetches `wasm_exec.js`, wraps it in a blob URL, then boots its worker from a second blob-URL script whose body is `importScripts('<blob-url>'); (fn)(...)`. The `Worker` construction is covered by `worker-src 'self' blob:`, but blob-URL workers inherit the document's CSP, and both the worker script element load and the `importScripts` inside it are governed by `script-src`(`-elem`). No first-party code needs `script-src blob:` (every app `createObjectURL` is a download anchor).

**Empirical verification (the non-AI check).** Removing `blob:` was deployed to the beta channel and live-tested 2026-07-17: go-online fails with `Loading the script 'blob:...' violates ... "script-src 'self' 'wasm-unsafe-eval'"` and messaging never connects; restoring it fixes go-online. Investigation + restore: the two AUDIT-2026-07-001 commits on `beta`.

**Accepted trade-off.** `blob:` in `script-src` converts a DOM-XSS foothold that can reach `URL.createObjectURL` into full script execution — a recognised CSP-bypass class and a real weakening of the first line of XSS containment. Accepted because messaging is a headline feature, the alternative (forking xxdk-wasm to ship a same-origin worker entry file) is a maintenance burden out of proportion to a *defence-in-depth* erosion (not a direct hole: an attacker still needs an XSS foothold first, and inline scripts remain blocked). Same treatment as the `wss://*` wildcard: documented in the `_headers` comment + here.

**Revisit trigger.** If a future `xxdk-wasm` version boots its worker from a same-origin file, drop `blob:` from `script-src` the same release.
