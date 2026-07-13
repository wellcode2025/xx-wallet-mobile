# PROJECT_STATE.md — xx Wallet Mobile

> Live status ledger. **Updated every session that changes the project**, before the session ends. This replaces the status-narrative sections that used to live in `CLAUDE.md`; the phase-by-phase build history remains in the internal handoff doc (local-only, not in the public tree). See `PROJECT_DOCTRINE.md` §12.

_Last updated: 2026-07-12 by the Lead — date corrections (the doctrine-adoption evening was 2026-07-11, not 07-08)_

---

## Now

- **Doctrine adoption COMPLETE** (brownfield audit Stages 1–3, `218f47e`; Stage 4 declined as unnecessary). **Release workflow LIVE and verified** (ADR-0016 + amendment, `603368b`): beta channel at the Workers preview alias, `main` PR-only behind required CI, direct-push rejection verified (`GH013`).
- **Pre-launch program** (launch ~mid/late July 2026): launch website (separate workstream) → GitHub/README organisation → code audit #2 (scoped by the Gap Report tier map) → launch.

## Next

- Pre-launch program remainder: GitHub/README organisation → code audit #2 (scoped by the Gap Report tier map) → launch website goes live → launch.
- Pre-launch ritual when the time comes: bump `version.ts` + What's-New entry (offline delivery as marquee).

## Workflow (in force since ADR-0016)

Day-to-day commits land on **`beta`** (auto-deploys to the beta preview URL). Production releases are **beta→main pull requests** — `main` rejects direct pushes and requires the CI `checks` job green. The PR description carries the review record for T1+/T2 work.

## Blocked

- _(nothing blocked)_

## Recently done

- **2026-07-12:** Public-docs refresh for launch: README gains a CI badge, a Memos/messaging
  feature section (coordination-first), council-vote + submit-proposal in governance, the real
  clone URL, the corrected existential deposit (1 XX, read live — the table contradicted ADR-0009),
  and an engineering-process paragraph. CONTRIBUTING: PRs target `beta`, spike-scripts wording
  fixed (they're not in the public tree), constants.ts description matches ADR-0009.
  ARCHITECTURE: cmix/ + worker/ + Memos added, new Messaging section (ADR-linked), deployment
  section rewritten for the two release channels. Internal-process comment refs in src/: already
  zero (June scrub was complete).
- **2026-07-11 (late):** Doctrine adopted (Stages 1–3, `218f47e`): Gap Report, ADRs 0001–0016, public CLAUDE.md, this ledger, three gates installed + hooks active, internal filter consolidated into tracked `.gitignore`. Release-channel machinery built (ADR-0016): `[env.beta]` Worker config, CI mirror workflow, boundary-gate `--tree` mode — independent review caught day-one CI false positives pre-commit (fixed); gitleaks full-history trial clean (192 commits).
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
