# ADR-0016: Two release channels — beta branch auto-deploys to a beta Worker; main is PR-only behind required CI

- Status: accepted
- Date: 2026-07-11
- Tier: T2 (deploy configuration)
- Review: independent

## Context

Push access to `main` *is* deploy access to a live wallet (ADR-0013): the GitHub-connected Cloudflare build deploys whatever lands there, and nothing on that path runs the test suite. All development previously happened directly on `main` — every commit was, in effect, a production release. The Gap Report (axis 4/6) named this the largest unguarded risk. With launch approaching, "once it starts you can't go back": the workflow must exist and be practiced *before* the audience arrives.

## Decision

Two channels, one promotion gate:

- **`beta` branch** — day-to-day integration. A second GitHub-connected Workers Build deploys it (`wrangler deploy --env beta`) to a separate Worker, `xx-wallet-mobile-beta`, on its default workers.dev origin. Deliberately obscure URL, no custom domain, separate browser storage from production.
- **`main` branch** — production (`mobile.xx.network`). Branch-protected: **no direct pushes (including the Owner); changes arrive only by beta→main pull request with the CI job green as a required check.** The PR is the doctrine's Integrate step — its description carries the review record for T1+/T2 work.
- **CI** (`.github/workflows/ci.yml`) mirrors the local gates, since `--no-verify` bypasses hooks but not the server: typecheck, full vitest run, the boundary gate in strict `--tree` mode, and a full-history gitleaks scan with the committed allowlist.

Emergency path: the Owner can disable branch protection in repo settings, push, and re-enable — deliberate, visible in the audit log, and to be recorded per doctrine §9.

## Alternatives considered

- **Required CI but direct pushes allowed:** rejected — the protection would exist only when voluntarily used, which is the status quo's failure mode restated.
- **Cloudflare Pages preview deployments instead of a second Worker:** rejected — the app is a Worker with a code path (the `/xxdk-wasm/*` proxy), not a plain static site; a named env keeps one config for both channels.
- **Custom beta subdomain (`beta.mobile.xx.network`):** declined for now — an official-looking hostname invites mistaking beta for a supported product; workers.dev is honestly unofficial. Reversible later without redeploying.

## Consequences

Failing tests can no longer reach production mechanically. Every production change gets a PR record. Costs: ~minutes of CI latency per promotion; the beta Worker is a second live wallet and inherits the production trust surface (SECURITY.md applies to it); Cloudflare build minutes double. The service worker's update prompt (ADR-0013) is unchanged — production users see releases only at promotion.

## Reversibility

Fully reversible: delete the protection rule, the beta build, and the env block. The habit is the valuable part; keep the machinery until a deliberate ADR retires it.

## Amendment (2026-07-11, same day)

Rollout revealed simpler plumbing than planned: Cloudflare's existing GitHub-connected Workers Build builds non-production branches automatically as **preview versions** with a stable per-branch alias — `beta-xx-wallet-mobile.<account>.workers.dev` — including the Worker code path (the `/xxdk-wasm/*` proxy verified working). The planned second Workers Build was therefore unnecessary and was not created; the `[env.beta]` wrangler config is retained for manual beta deploys or a future dedicated Worker. Verified live the same evening: CI green on both branches; a direct push to `main` rejected with `GH013` citing both the PR requirement and the required `checks` status; the ruleset has an empty bypass list (applies to the Owner).
