# PROJECT_STATE.md — xx Wallet Mobile

> Live status ledger. **Updated every session that changes the project**, before the session ends. This replaces the status-narrative sections that used to live in `CLAUDE.md`; the phase-by-phase build history remains in the internal handoff doc (local-only, not in the public tree). See `PROJECT_DOCTRINE.md` §12.

_Last updated: 2026-07-08 by the Lead (brownfield audit session)_

---

## Now

- **Doctrine adoption (brownfield audit):** Stage 1 (Gap Report) and Stage 2 (ADRs 0001–0015) complete and Owner-approved. Stage 3 in progress this session: gates written, CLAUDE.md restructured, this ledger created; remaining — gates install (symlinks), tracked-.gitignore consolidation, doctrine/template files copied into the repo.
- **Pre-launch program** (launch moved to ~mid/late July 2026): launch website (separate workstream) → GitHub/README organisation → code audit #2 (scoped by the Gap Report tier map) → beta/main branch workflow + second Cloudflare Pages project → launch.

## Next

- Install gates + CI mirror (typecheck, `vitest run`, gitleaks, boundary gate strict) — pairs with the beta/main workflow build.
- Stage 2 leftover: none — ADR set complete pending any Owner corrections.
- Pre-launch ritual when the time comes: bump `version.ts` + What's-New entry (offline delivery as marquee).

## Blocked

- _(nothing blocked)_

## Recently done

- **2026-07-08:** Governance participation — `elections.vote` (council voting w/ stake validation + removeVoter) and `democracy.propose` (inline ≤128 bytes or notePreimage+Lookup batch), spike-verified against the live chain, live-tested (`c038438`). Contact QR codes made reliably scannable (`d0f1de6`).
- **2026-07-07:** Offline-message delivery fixed — the two-layer cold-resume race (fingerprints, then listeners) closed wallet-side with stock xxdk-wasm (`9f05507`, `b26b8b8`, `7c4d3db`); verified on-device: offline→cold-open delivery in ~4s with the sender offline throughout. Channel reset for stuck half-established connections (`842fe0f`); chat timestamps in device-local time (`d1cf610`).
- **2026-07-01:** Two-way handshake gate on chat send; sender-side re-send backstop for un-acked memos; Max-send fix (ED read from chain — ADR-0009).
- **2026-06-30:** Private messaging v0.10.0 announced — per-account cMix identities, dedicated passphrase, encrypted multi-identity backup, 1:1 chat with delivery ACKs, multisig coordination over cMix.
- Full earlier history (phases 1–4, Ledger, app lock, audit #1 remediation): internal handoff doc + `git log`.

## Open questions

- **>24h offline lookback:** cMix tracker lookback covers ~24h; longer gaps need a Login-with-history path (`AddIdentityWithHistory` — in the Go client, not exposed in xxdk-wasm 0.3.22). Client-fork + binding project, only if judged worth it; gateways purge undelivered messages after ~21 days regardless.
- **T1↔phone poisoned contact pair:** parked postmortem — crossed stale channel requests on both sides; cure to try: phone deletes the contact, fresh blob, single reset, both online (Android debugging via `chrome://inspect`).
- **First-ACK settle:** the first double-checkmark sometimes lands only after the first reply — settle-the-channel-before-first-ACK / retry-ACK-once polish item.
- **iOS PWA update banner:** installed iOS PWAs can sit on an old version until force-quit; wire `useRegisterSW` + an update banner.
- **i18n:** post-launch, weeks-scale.
- **Upstream notes to file:** gateway grpc-web EOF degradation (browser clients); garbled-retry gap in xxdk.
