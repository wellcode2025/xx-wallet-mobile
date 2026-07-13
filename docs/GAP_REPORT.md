# Gap Report — xx Wallet Mobile vs. PROJECT_DOCTRINE

*Brownfield audit, Stage 1 (read-only). 2026-07-11.*

> **Status update, 2026-07-12:** this report is a point-in-time snapshot; its major gaps have
> since been closed. Enforcement (axis 4): the three gates are installed as hooks and mirrored in
> CI, which now runs typecheck, the full test suite, the boundary check, and a secret scan on
> every push and PR. Decision record (axis 2): ADRs 0001–0016 exist. Ledger (axes 1/5):
> `PROJECT_STATE.md` is the single live ledger and `CLAUDE.md` the governing facts sheet. The
> internal-material filter (axis 3) lives in the tracked `.gitignore`. `main` is branch-protected
> behind required CI (ADR-0016). Remaining open: the optional Stage 4 workspace tidiness only.
*Evidence: live run at `c038438` (HEAD = origin/main, clean tree) — typecheck green, 452/452 tests across 38 files, zero git hooks installed, no CI workflows.*

This report assesses the repo against the engineering-lead doctrine's seven axes. Nothing was changed except this file. Each axis reports **Wants / Has / Gap / Cost-Risk**; the report ends with the tier map, THE RULE, a candidate-ADR list, and a prioritisation.

**Context worth stating up front:** this project is *not* the doctrine's typical patient. It has an unusually strong written-memory culture — a rich `CLAUDE.md`, a canonical `docs/HANDOFF.md`, a serious `SECURITY.md`, and design docs whose invariants the code still enforces. The gaps below are mostly about *mechanical enforcement* and *consolidation*, not about missing memory. The doctrine's biggest wins here are the gates and the tier discipline, not the files.

---

## Axis 1 — Single source of truth

**Wants:** one governing file a session reads first, with the project's facts, rules, and risk map.

**Has:** `CLAUDE.md` at the root is a genuine governing file and is auto-read every session. It carries the stack, hard rules (constants.ts, the scrypt/unlock path), the working environment, and "what good looks like." `docs/HANDOFF.md` is the declared canonical build state; `SECURITY.md` is the threat model.

**Gap:** `CLAUDE.md` mixes four roles — facts sheet, status narrative, house rules, and phase history — and its status sections duplicate `HANDOFF.md` (two ledgers, see Axis 5). It contains no explicit **tier map** and no stated **THE RULE**; the risk discipline exists in practice but isn't written as policy. Governance content is also split across two levels (root vs `xx-wallet-mobile/docs/`).

**Cost-Risk:** low cost — restructure one file, no code moves. Risk of *not* fixing: drift is already observable (status sections trail this week's eight commits).

## Axis 2 — Decision record

**Wants:** the *whys* on disk, one small file per decision.

**Has:** rationale is unusually well recorded — but scattered: design docs (`PHASE_2A_MULTISIG_DESIGN.md` §6.4/§7.3/§12), `SECURITY.md` (no-biometric-to-sign, app-lock scope, deployment trust model), `CLAUDE.md` prose ("decisions on record"), commit messages, and assistant session memory (off-repo, tool-specific).

**Gap:** no `docs/adr/`. Several load-bearing decisions live *only* in session memory or commit messages — invisible to any other tool, contributor, or auditor. The reasoning survives today because one person plus one assistant hold it; that's the exact single-point-of-failure the doctrine targets.

**Cost-Risk:** cheapest, highest-leverage fix in this report. Zero code risk (Stage 2 moves no files). Candidate list at the bottom.

## Axis 3 — Folder structure

**Wants:** structure that encodes where things go.

**Has:** `xx-wallet-mobile/src/` is disciplined and self-describing: `api/ keyring/ cmix/ ledger/ store/ hooks/ screens/ components/ notifications/ staking/ governance/ utils/`. New code has an obvious home; the structure has held through seven feature phases without sprawl.

**Gap:** *(corrected after a `git ls-files` check — the first draft of this report wrongly said this material was committed.)* The **public tree is already clean**: the vendored reference repos and internal docs were removed from tracking in `bd8c5a6` / `869c178`, and none of `reference/`, `outputs/`, `indexer-staking-fix/`, `docs/_external-reference/`, or the internal docs (`HANDOFF.md` etc.) are tracked today. The remaining gap is **filter robustness**: several of those ignore rules live outside the tracked `.gitignore` (in `.git/info/exclude` or a global gitignore) — local-only config that does not travel with a clone. On any other machine, checkout + `git add -A` would re-introduce the internal material with no guard. The root is also still a *workspace* (internal material interleaved with the product), which the tracked `.gitignore` only partially describes.

**Cost-Risk:** much smaller than first reported. The fix is Stage 3-sized, not Stage 4: move every internal-material rule into the **tracked** `.gitignore` so the filter is a property of the repo, not of this machine. No file moves required for safety; relocating the workspace folders stays optional Stage 4 tidiness.

## Axis 4 — Enforcement gates

**Wants:** rules that run as scripts, whether or not anyone remembers them.

**Has:** a strong *habitual* gate: typecheck + full test suite before every commit block, `git status` before staging — but enforced by session memory and personal ritual, not machinery. `.gitleaks.toml` exists (audit #1 artifact). ESLint configured. The Cloudflare deploy runs `tsc` (via `build`), so type errors can't ship.

**Gap:** **nothing runs automatically.** Zero git hooks. No CI (`.github/workflows/` absent). The test suite is never executed on the deploy path — a push to `main` with failing tests ships to `mobile.xx.network`. gitleaks has a config but no runner attached to anything. This is the doctrine's core scenario: the discipline is real but lives in memory, so it holds only while memory does.

**Cost-Risk:** cheap and immediate (Stage 3): install `pre-commit` (secret scan) + `commit-msg` (tier trailers) + the project boundary gate; add a minimal CI that runs typecheck + tests + gitleaks on push. Highest-leverage mechanical fix available.

## Axis 5 — State ledger

**Wants:** "where we are" on disk, updated every session.

**Has:** `docs/HANDOFF.md` (declared canonical) plus `CLAUDE.md` status blocks plus session memory — three ledgers.

**Gap:** the duplication makes updates a seven-item manual sweep, so it happens in batches; both on-disk ledgers currently trail the last eight commits (offline-delivery fix, timestamps, channel reset, QR, resend backstop, elections.vote + democracy.propose). Between sweeps, the true state exists only in session memory.

**Cost-Risk:** low. Stage 3 should **merge, not add**: one live ledger (`PROJECT_STATE.md`, seeded from `HANDOFF.md`), with `CLAUDE.md` reduced to facts + rules + tier map, and `HANDOFF.md` retired into it or kept as history. Adding a fourth ledger would make this axis worse.

## Axis 6 — Risk concentration

**Wants:** the most dangerous code identified and guarded.

**Has / where the danger is:**

1. `src/keyring/` — key generation, scrypt keystore (N=131072 compat, H-1..H-3), the load-bearing async `unlock()`, Sleeve.
2. Signing paths — `useTx`, `useSequentialTx`, governance/staking TxFooters, `src/ledger/`.
3. Approval-surface integrity — `utils/decodeCall.ts`, `utils/bytesPackage.ts`, multisig approve/propose, preimage decoding (the §6.4 invariant).
4. Messaging credentials — `cmix/storageSecret.ts`, `identity.ts`, `identityExport.ts`, `deviceKey.ts`, `contactBinding.ts`.
5. `api/constants.ts` — chain-baked values; wrong values fail silently.
6. The deploy pipeline — push access to `main` **is** deploy access to a live wallet.

**Guarding today:** good unit tests on the pure logic (decoder, multisig derivation, scrypt bounds, bytes-package, address derivation); hard rules in `CLAUDE.md`; hash-gate and derive-locally checks in code. **Not guarded:** nothing mechanically flags a diff that touches these areas; no independent review step; no gate between a commit and production beyond `tsc`.

**Cost-Risk:** the tier trailers + boundary gate close most of this cheaply; the beta→main promotion (already planned) supplies the missing review checkpoint before production.

## Axis 7 — Tier / exposure map

Per doctrine §3, anything wrapping crypto/key/signing is T2 until proven otherwise.

**T2 — Critical** (independent review + non-AI check before merge):

- `src/keyring/**` (incl. `sleeve.ts`)
- `src/utils/decodeCall.ts`, `src/utils/bytesPackage.ts`
- `src/hooks/useTx*.ts` and every screen-level tx submission path; `src/ledger/**`
- `src/cmix/storageSecret.ts`, `identity.ts`, `identityExport.ts`, `deviceKey.ts`, `contactBinding.ts`
- `src/api/constants.ts`
- `src/utils/pin.ts`, `src/utils/webauthn.ts` (access gate, crypto-adjacent — tiered up)
- `public/_headers` (CSP, Permissions-Policy — load-bearing for Ledger), deploy configuration

**T1 — Boundary** (plan + independent review + ADR):

- Multisig propose/approve/share flows; Send/recipient handling
- cMix transport: `cmix/e2e.ts`, `messaging.ts`, `session.ts`, `store/cmix*.ts`, receive/resend notification hooks (parse external input)
- Contact import/export, QR scan, config-JSON import (external input)
- Staking + governance transaction screens; Settings RPC-endpoint validation

**T0 — Routine:** presentational components, copy, formatting utils, docs, layout, read-only views without external input.

**THE RULE** (Owner-decided 2026-07-11, one boundary gate, two facets):

1. **Decode-from-bytes (§6.4):** no signing or approval surface renders a description it didn't decode from call bytes verified against the on-chain hash. Depositor-, sender-, or file-supplied text is never the narrative.
2. **Keyring isolation:** key material and keystore operations are confined to `src/keyring/`; nothing else imports `@polkadot/keyring` or handles decrypted key bytes.

Crossing either facet makes a change T1 minimum; touching the listed T2 files makes it T2.

---

## Candidate-ADR list (Stage 2 input)

Decisions clearly made, currently scattered or off-repo. Marked for the public/internal filter.

| # | Decision | Where it lives now | Filter |
|---|----------|--------------------|--------|
| 1 | scrypt N=131072 for wallet.xx.network keystore compat (H-1); v3-format pinning (H-3) | SECURITY.md, code comments | public |
| 2 | §6.4 decode-or-refuse as the central invariant (kills depositor-as-narrator) | PHASE_2A design doc | public |
| 3 | No biometric-to-sign; fund 2FA must be chain-enforced (multisig / hardware / delay proxy); app lock is access-gate-only | SECURITY.md, session memory | public |
| 4 | Per-account cMix identities (unlinkability over convenience); fixed sender identity per thread | CLAUDE.md prose | public |
| 5 | Dedicated messaging passphrase, separate from wallet passwords; identity portability via encrypted backup, not derivation | CLAUDE.md prose | public |
| 6 | Memo is transport, never instruction — cMix-delivered call data re-validated against on-chain hash | CLAUDE.md, code | public |
| 7 | Ledger: no Bluetooth (upstream ledgerjs#352), no iOS, refuse-what-the-device-can't-display | CLAUDE.md, code comments | public |
| 8 | Cold-resume ordering contract: eager Logins + buffered listeners before the follower starts | commit messages 9f05507/b26b8b8 | public |
| 9 | `transferKeepAlive` + ED-aware Max (ED read from chain, never hardcoded) | commit 35b4ecc, session memory | public |
| 10 | Indexer is an untrusted narrator; privacy toggle enforced at a single gate; funds never depend on it | SECURITY.md | public |
| 11 | xx v206 codec convention: enums via `.toJSON()`, structs via named field, mangle guards (two production bugs) | session memory only | public |
| 12 | SW `registerType: 'prompt'`, no version pin / signature check — accepted risk, documented trust model | SECURITY.md | public |
| 13 | Chain-first (not indexer-first) reads for staking/governance | session memory, design history | public |
| 14 | Strategic posture and phase ordering (standalone wallet, multisig-first) | session memory, STRATEGY_UPDATE.md | **internal** — keep out of public ADRs or reduce to a neutral summary |

## Prioritisation

Memory and enforcement fixes first (cheap, safe, urgent); structure last (expensive, riskier):

1. **Stage 3 gates + tier discipline** — install pre-commit secret scan (wire `.gitleaks.toml`), commit-msg trailers, and the two-facet boundary gate; add minimal CI (typecheck + tests + gitleaks). Closes Axis 4, the biggest mechanical gap. Rides naturally with the planned beta/main + dual Cloudflare Pages work, whose promote step becomes the review checkpoint (Axis 6).
2. **Stage 2 ADRs** — capture the table above; apply the public/internal filter. Closes Axis 2 at near-zero risk.
3. **Stage 3 ledger merge** — one live state file; `CLAUDE.md` reduced to facts + rules + tier map + THE RULE. Closes Axes 1 and 5. *Merge, don't add.*
4. **Stage 3 addendum — make the internal filter travel:** move the local-only ignore rules (`.git/info/exclude` / global gitignore) for `docs/HANDOFF.md`, `docs/_external-reference/`, `indexer-staking-fix/`, `reference/`, `outputs/` into the tracked `.gitignore`. Cheap, closes the only real Axis 3 risk.
5. **Stage 4 (surgical, itemised, only if wanted)** — optional workspace tidiness: relocate the ignored internal folders out of the repo root. Cosmetic once item 4 is done; belongs inside the GitHub-organisation workstream if at all.

---

**STAGE 1 GATE:** this report changes nothing else. Stage 2 (ADR capture) proceeds only on Owner approval.
