# PROJECT_STATE.md — xx Wallet Mobile

> Live status ledger. **Updated every session that changes the project**, before the session ends. This replaces the status-narrative sections that used to live in `CLAUDE.md`; the phase-by-phase build history remains in the internal handoff doc (local-only, not in the public tree). See `PROJECT_DOCTRINE.md` §12.

_Last updated: 2026-07-21 by the Lead — v1.0.0 launch ritual complete on `beta`_

---

## Now

- **v1.0.0 ON `beta`, awaiting launch morning** (2026-07-21): launch ritual complete — version bump + What's-New + README badge (`13a5bc3`, T0) and both parked deploy-config chores at full T2 ceremony (`11e2794` CI actions v4→v6, `e219947` wrangler.toml comment; independent reviews PASS). Pending: Owner observes CI green on the beta push (the recorded Non-AI check for `11e2794`) + v1.0.0 spot-check on the beta alias → ONE beta→main PR opens **2026-07-23 10:00 PDT** (description pre-drafted); merge = production launch, same morning the launch site goes live.
- **Code audit #2 CLOSED end-to-end** (2026-07-20): remediated on `beta` (`79ce245`+`8f56962`, `988d160`, `19923b1`), three independent reviews PASS, promoted via **PR #5** — the first PR gated by the new CI `Tier trailers` range check (fired live: "4 code commit(s) classified correctly") — deployed to production and live-verified (CSP byte-identical to pre-session, mixnet connects). Review records in PR #5; advisory follow-ups logged below.
- **Release workflow LIVE** (ADR-0016 + amendment): beta channel at the Workers preview alias (`beta-xx-wallet-mobile.<account>.workers.dev` — note: the `[env.beta]` block in wrangler.toml is NOT what the build uses; non-production-branch builds version-upload to the same Worker), `main` PR-only behind required CI.
- **Pre-launch program** (launch ~2026-07-23): launch website (separate workstream) → launch.

## Next

- **Launch morning (2026-07-23 10:00 PDT):** confirm launch site live → open the prepared beta→main PR → CI `checks` green (incl. the tier-trailer range check over the three commits) → merge = launch.
- **Review-advisory follow-ups (non-blocking, from the audit-2 review passes):** (1) `_headers` `worker-src` comment still says "service worker is same-origin only" while the directive is `'self' blob:` — same comment/header-drift class as AUDIT-2026-07-001, log as its own item; (2) ADR-0014 amendment wording nit: the blob worker's top-level fetch is `worker-src`-governed, only the inner `importScripts` is `script-src` — fix next time 0014 is touched; (3) re-confirm `main` branch protection (required `checks`) whenever protection settings are next touched.

## Workflow (in force since ADR-0016)

Day-to-day commits land on **`beta`** (auto-deploys to the beta preview URL). Production releases are **beta→main pull requests** — `main` rejects direct pushes and requires the CI `checks` job green. The PR description carries the review record for T1+/T2 work.

## Blocked

- _(nothing blocked)_

## Recently done

- **2026-07-21:** v1.0.0 launch ritual on `beta`. Version bump everywhere it lives (sweep-confirmed
  four places: package.json/lockfile, version.ts `APP_VERSION`, README badge, Settings→About — the
  last now imports `APP_VERSION` so it can't drift again) + launch What's-New entry per house style
  (`13a5bc3`, T0). Both parked deploy-config chores done at full T2 ceremony — they'd been filed in
  Next as "T0 chore" but `gates/t2-paths` machine-enforces these paths as T2; corrected: CI actions
  v4→v6 (Node-24 majors verified from release pages; checkout-v6 credential relocation and
  setup-node-v6 npm-only auto-cache both inert here) `11e2794`, Non-AI-Check = Owner-observed CI
  green on the push; wrangler.toml `[env.beta]` comment aligned with recorded deploy reality
  (comment-only) `e219947`. Both independent reviews PASS (packet-only subagent passes). Launch PR
  description pre-drafted; PR opens launch morning.
- **2026-07-17:** Code audit #2 REMEDIATED, all four findings, on `beta` (T2 ceremony throughout):
  **001** `script-src blob:` investigated by live removal test on beta — xxdk-wasm's blob-worker
  bootstrap requires it (CSP violation observed, go-online blocked) → kept + `_headers` comment
  fixed + ADR-0014 amendment with revisit trigger (`79ce245` + `8f56962`). **002** new
  `xxKeyring.signMessage` (unlock→sign→lock+evict inside the keyring); both contact-binding
  screens routed through it — no unlocked pair in UI code; 3 unit tests, 455 green (`988d160`).
  **003+004** `gates/commit-msg --range` mode + shared `gates/t2-paths` tier-map regex + CI
  steps: production `vite build` + PR-range tier-trailer assertion (commits touching T2 paths
  must be `Tier: T2`); boundary gate now also flags `xxKeyring.unlock(` outside keyring/useTx
  (`19923b1`). Toolchain re-run clean 5/5: npm audit 0, osv-scanner 0 (754 pkgs), semgrep 0
  (265 files, 94 rules), eslint strict clean, gitleaks 0 (203 commits). Audit #1 baseline SHA
  corrected in project memory (`78374aa..6826a40`). Awaiting independent reviews → beta→main PR.
- **2026-07-12:** GitHub/README organisation COMPLETE (promoted to main via PR). README: CI badge,
  Memos feature section, governance participation additions, real clone URL, corrected ED (1 XX,
  read live), engineering-process paragraph, twelve current launch screenshots (pre-Memos set
  retired), and a confident-realism IMPORTANT block — "use at your own risk" replaced with
  done → not-yet → what-to-do framing (tone framework adopted; v1.0.0-at-launch decided).
  CONTRIBUTING: PRs target `beta`; spike/constants wording matched to reality. ARCHITECTURE:
  cmix/worker/Memos + Messaging section + release channels. SECURITY.md: trust model reflects
  protected main. GAP_REPORT: status note (gaps closed). Final sweep: src/ comment refs zero,
  no stale ED/risk language anywhere public.
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
