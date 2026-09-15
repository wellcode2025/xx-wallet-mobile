# PROJECT_STATE.md — xx Wallet Mobile

> Live status ledger. **Updated every session that changes the project**, before the session ends. This replaces the status-narrative sections that used to live in `CLAUDE.md`; the phase-by-phase build history remains in the internal handoff doc (local-only, not in the public tree). See `PROJECT_DOCTRINE.md` §12.

_Last updated: 2026-09-14 by the Lead — gate fixes ported from selvage-labs; the secret scan and the boundary gate both fixed where they failed open (ADR-0017), on `beta`_

---

## Now

- **Gates repaired on `beta` (2026-09-14, T2, ADR-0017).** `gates/pre-commit`
  and `gates/xx-wallet-boundary` each had paths where they printed nothing,
  exited 0, and had scanned no content at all. Seven such defects are fixed —
  five ported from `selvage-labs` (its ADR-0002), two found during the port, one
  of which was in the selvage gate too and was fixed there the same session.
  **The generic credential heuristic is removed rather than narrowed.** Four
  review rounds produced four blocking findings, all inside the same forty
  lines: it blocked 13 lines of real wallet code; narrowed, it silently accepted
  a word-based passphrase in production source; narrowed again, it accepted a
  bare word in `.env`/YAML/shell and made this very change uncommittable; and
  the carve-out for that then blocked ordinary placeholder text. The high-signal
  patterns stay (zero findings in four rounds), all the plumbing hardening
  stays, and `gitleaks` now does the deciding — used locally when installed,
  already mandatory in CI over full history. `gates/test-gates.sh` is the
  recorded non-AI check: 65 cases, every fix mutation-tested. Round 6 also found
  that the gate never entered the repository root, so `gitleaks protect
  --staged` — which scopes itself to the process's working directory — scanned
  only a subtree when the gate was run by hand from one. Fixed, with `--source`
  passed explicitly.
  **CI's half of that is now fixed too (ADR-0018, 2026-09-15):** `gitleaks
  detect --source .` walks history by diffing it itself, and that diffing
  honours `.gitattributes`, so a path marked `-diff` or `binary` was skipped
  silently — permanently, and reachable by anyone who can open a PR, with no
  backstop anywhere. CI now writes `* diff` to `.git/info/attributes` before
  scanning, which takes precedence over the in-tree file and cannot be switched
  off by a commit. `gates/test-ci-secret-scan.sh` is the runnable proof — 24 cases that
  EXECUTE the workflow's own step under Actions' real shell semantics and read
  the verdict from a file only the scanner can write. **Three review rounds were
  needed to make the test honest**, each finding a weaker proxy than the last:
  a substring in the workflow text, then the step's exit code, then a substring
  in the step's whole output. All four mutations now fail.
  Known limit, verified: gitleaks skips some file extensions (`.bin`, `.jpg`,
  `.pdf`, `.zip`, `.exe`) outright, which no attribute override reaches.
  Round 7 found that gitleaks inherits the very blind spot the local scan was
  hardened against: `gitleaks protect --staged` does its own diffing, which
  honours `.gitattributes`, so a file marked `-diff` or `binary` was skipped
  silently. The gate now pipes its own hardened diff to `gitleaks detect
  --pipe` — the ADDED lines only, because gitleaks is not diff-aware there and
  piping the whole diff blocked the commit that *removes* a secret, which is the
  remediation for the very problem the gate exists to prevent. **CI has the same blind spot and is NOT yet fixed** — see Next.
  **Known and deliberate:** with gitleaks absent, only the six high-signal
  shapes are caught locally; a generic quoted API key, a passphrase, a database
  URL with a password, and a Stripe-shaped key all pass silently. CI catches
  them at push. Installing gitleaks locally closes it.
  **Not yet merged to `main`** (ADR-0016: beta→main PR behind CI).

- **v1.0.0 LIVE in production** (2026-07-21, evening): beta→main PR merged ahead of schedule — Owner's call to decouple the deploy from the announcement (production had ~36h of quiet to surface deploy issues; existing installed users seeing the v1.0.0 What's-New pre-announcement accepted knowingly). All checks green including the tier-trailer range check over the three commits; Owner verified beta alias pre-merge and production post-merge (About 1.0.0, What's-New fires once, go-online connects). The **public launch moment** is now the launch site + announcement, **2026-07-23 10:00 PDT**.
- **Code audit #2 CLOSED end-to-end** (2026-07-20): remediated on `beta` (`79ce245`+`8f56962`, `988d160`, `19923b1`), three independent reviews PASS, promoted via **PR #5** — the first PR gated by the new CI `Tier trailers` range check (fired live: "4 code commit(s) classified correctly") — deployed to production and live-verified (CSP byte-identical to pre-session, mixnet connects). Review records in PR #5; advisory follow-ups logged below.
- **Release workflow LIVE** (ADR-0016 + amendment): beta channel at the Workers preview alias (`beta-xx-wallet-mobile.<account>.workers.dev` — note: the `[env.beta]` block in wrangler.toml is NOT what the build uses; non-production-branch builds version-upload to the same Worker), `main` PR-only behind required CI.
- **Pre-launch program** (launch ~2026-07-23): launch website (separate workstream) → launch.

## Next

- **Unpinned CI secret-scanner download (T2, own change).**
  `.github/workflows/ci.yml` fetches the gitleaks tarball over HTTPS with **no
  checksum**, so the tool CI trusts to find secrets is itself unverified supply
  chain. Noticed while fixing ADR-0018; deliberately not bundled into that diff.
  Fix is a `sha256sum -c` against a pinned digest, or the official action.

- **Launch morning (2026-07-23 10:00 PDT):** wallet side is DONE — launch site goes live + announcement (separate workstream). Nothing to deploy.
- **Review-advisory follow-ups (non-blocking, from the audit-2 review passes):** (1) `_headers` `worker-src` comment still says "service worker is same-origin only" while the directive is `'self' blob:` — same comment/header-drift class as AUDIT-2026-07-001, log as its own item; (2) ADR-0014 amendment wording nit: the blob worker's top-level fetch is `worker-src`-governed, only the inner `importScripts` is `script-src` — fix next time 0014 is touched; (3) re-confirm `main` branch protection (required `checks`) whenever protection settings are next touched.

## Workflow (in force since ADR-0016)

Day-to-day commits land on **`beta`** (auto-deploys to the beta preview URL). Production releases are **beta→main pull requests** — `main` rejects direct pushes and requires the CI `checks` job green. The PR description carries the review record for T1+/T2 work.

## Blocked

- _(nothing blocked)_

## Recently done

- **2026-09-14 — the gates were failing open; fixed (T2, ADR-0017).** The secret
  scan is the one block the doctrine refuses to let anyone override, and this is
  a wallet. Seven defects, all the same shape — the gate reports success having
  scanned nothing:
  (1) a `.gitattributes` `-diff`/`binary` entry or a `diff.external` setting hid
  staged content entirely; (2) the assignment pattern matched only *unquoted*
  values, so every realistic `api_key = "…"` passed; (3) one NUL byte anywhere
  in the staged set blanked the scan; (4) `git diff` failing was `|| true`'d into
  an empty scan; (5) `printf | grep -q` under `pipefail` passed any commit over
  ~64 KB of added text; (6) the two filter stages were chained, so a stage-1
  `grep` dying with rc 2 was masked by stage 2's rc 1 — `bash -c 'set -o
  pipefail; (exit 2) | (exit 1); echo $?'` prints `1`; (7) the **boundary gate**
  had the same chained-pipeline defect in the path CI enforces, so one failing
  `grep` made `XXWALLET_BOUNDARY_STRICT=1 … --tree` exit 0 with a real
  `@polkadot/keyring` violation staged. Its filename handling also skipped any
  path containing a space.
  Fixes 6 and 7 were found by the independent review of this very port; fix 6
  exists in `selvage-labs` too and was applied there the same day.
  The heuristic pattern was narrowed three ways (no `-` before the keyword; the
  **value** must contain a digit or `/ + =`; it does not apply to `*.test.ts`),
  because run against `src/` it matched 13 committed, innocent lines. High-signal
  patterns (private keys, provider tokens, JWTs) still apply everywhere.
  Three review rounds, three BLOCK verdicts. The third caught a **regression in
  the fix itself**: narrowing the heuristic to "the value must contain a digit"
  silently accepted a quoted word-based passphrase (the
  `correct-horse-battery-` … `staple` shape) in
  production source — a false negative worse than the false positive it cured,
  because nothing is printed for anyone to see. The rule is now "the value is
  **quoted**, or contains a digit or `/ + =`", which catches word-based secrets
  and still lets identifiers through. Also fixed: `git rm` of a `.ts` file was
  reported UNVERIFIED by the boundary gate, and its T2 advisory printed every
  filename concatenated onto one line.
  Round 4 found two more, both in the fix rather than the original gate: the
  replacement rule accepted a bare word in a `.env`, YAML or shell file, where
  an unquoted value IS a literal (requirement (b) is now switched off for those
  formats); and the change could not be committed at all, because the ADR's own
  illustrative example tripped the strengthened gate. Examples are now assembled
  at runtime or written as prose.
  Verified: all 362 files of the tree staged at once pass both gates; a
  non-ignored `.env`, `.yml` and `.sh` with a bare-word secret all block;
  `gates/test-gates.sh` 89/89, and every fix mutation-tested — revert it and a
  named case fails.

- **2026-07-25:** Onboarding warnings from post-launch community feedback (X user: "wallet forgot
  my accounts, then my Q phrase gave a new empty address"). Both symptoms were app-permitted user
  error: ephemeral storage (incognito/clear-on-exit) erasing the keystore, and the Sleeve quantum
  master phrase passing BIP39 validation but deriving a different sr25519 address. Copy/UI only,
  no logic: ImportWallet always-visible amber card (use the standard phrase only), CreateWallet
  password-step storage warning (deliberately no incognito detection — ADR-0015 warn-don't-gate)
  + PWA-install tip + funds-safe-on-chain reassurance, and a compact shared storage note on
  Welcome ahead of both paths. Typecheck + 455/455 green. `recoverSleeveFromQuantumMnemonic()`
  exists in `keyring/sleeve.ts` but stays un-wired — a future "recover from quantum phrase"
  import method is the real fix for the second trap. Follow-up sweep of warning coverage across
  all screens: ED/reaping, multisig→exchange, 28-day lock (bond/unbond/chill/withdraw),
  conviction lock-days, remove-account all already covered; one gap closed — caption under
  Export keystore (file+password = the funds; guard like the phrase). Memos 21-day retention
  note deliberately skipped as clutter.
- **2026-07-21:** v1.0.0 launch ritual on `beta`. Version bump everywhere it lives (sweep-confirmed
  four places: package.json/lockfile, version.ts `APP_VERSION`, README badge, Settings→About — the
  last now imports `APP_VERSION` so it can't drift again) + launch What's-New entry per house style
  (`13a5bc3`, T0). Both parked deploy-config chores done at full T2 ceremony — they'd been filed in
  Next as "T0 chore" but `gates/t2-paths` machine-enforces these paths as T2; corrected: CI actions
  v4→v6 (Node-24 majors verified from release pages; checkout-v6 credential relocation and
  setup-node-v6 npm-only auto-cache both inert here) `11e2794`, Non-AI-Check = Owner-observed CI
  green on the push; wrangler.toml `[env.beta]` comment aligned with recorded deploy reality
  (comment-only) `e219947`. Both independent reviews PASS (packet-only subagent passes). Launch PR
  description pre-drafted; PR opens launch morning. **Evening: merged to production ahead of
  schedule** (Owner's call — deploy decoupled from the 07-23 announcement); prod verified live.
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

- ~~Adopt `gitleaks` locally and retire the hand-rolled scanner?~~ **Decided 2026-09-14 (ADR-0017): yes.** The keyword heuristic is gone; gitleaks runs locally when installed and remains mandatory in CI. Remaining question is whether to make it a required local dependency, which would mean every contributor installs a binary before they can commit.
- **Superseded context:** `.gitleaks.toml`
  already exists for CI. Six of the seven ADR-0017 defects were in *status
  handling*, not pattern matching — any scanner that fails closed would have
  avoided them, which is an argument for gitleaks. Against: it adds a downloaded
  binary to the one gate that must run on every machine before every commit.
- **Carry ADR-0017 fix 6 back into the kit** (`eng-lead-system-kit-v2`) — it is a
  defect in the generic `pre-commit`, not something specific to either project.
- **Mirror the boundary gate's `scan_file` discipline in the kit's example gate**
  in `gates/README.md`, which still shows the chained-grep pattern.

- **>24h offline lookback:** cMix tracker lookback covers ~24h; longer gaps need a Login-with-history path (`AddIdentityWithHistory` — in the Go client, not exposed in xxdk-wasm 0.3.22). Client-fork + binding project, only if judged worth it; gateways purge undelivered messages after ~21 days regardless.
- **T1↔phone poisoned contact pair:** parked postmortem — crossed stale channel requests on both sides; cure to try: phone deletes the contact, fresh blob, single reset, both online (Android debugging via `chrome://inspect`).
- **First-ACK settle:** the first double-checkmark sometimes lands only after the first reply — settle-the-channel-before-first-ACK / retry-ACK-once polish item.
- **iOS PWA update banner:** installed iOS PWAs can sit on an old version until force-quit; wire `useRegisterSW` + an update banner.
- **i18n:** post-launch, weeks-scale.
- **Upstream notes to file:** gateway grpc-web EOF degradation (browser clients); garbled-retry gap in xxdk.
