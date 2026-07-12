# CLAUDE.md — xx Wallet Mobile

> Project governing file (the **variable layer**: what this project is). For *process* — tiers, inner loop, review, overrides — see `PROJECT_DOCTRINE.md`.
>
> **Read order each session:** `PROJECT_DOCTRINE.md` → this file → `PROJECT_STATE.md` (live status).

## One-line description

Mobile-first Progressive Web App wallet for the [xx network](https://xx.network) blockchain (Substrate-based, SS58 prefix 55). Standalone, non-custodial, no backend. Live at `mobile.xx.network`.

Feature surface: core wallet, multisig (incl. two-device protected accounts), full nominator+validator staking, full Gov1 governance, Ledger hardware accounts, and opt-in private messaging + multisig coordination over the xx mixnet (Memos tab). Current status lives in `PROJECT_STATE.md`; the phase-by-phase build history lives in the internal handoff doc (not in the public tree).

## Tech stack

React 18 + TypeScript + Vite + Tailwind + Zustand + `@polkadot/api` + `xxdk-wasm`. Vitest for tests. Use **npm**, not yarn. Deployed as a static PWA on Cloudflare Workers Static Assets (auto-deploy from `main`).

## Architecture shape

- **UI (screens/components/hooks)** — React SPA, mobile-first, bottom nav: Wallet / Staking / Governance / Memos / Settings.
- **Chain access (`api/`)** — `@polkadot/api` over `wss://` RPC; chain is the source of truth for anything funds-related.
- **Keyring (`keyring/`)** — the only module that touches key material (THE RULE, facet b). Local scrypt keystores + Ledger records (no keystore).
- **Messaging (`cmix/`)** — xxdk-wasm cMix client; one client/follower hosting one reception identity per wallet account; e2e chat + multisig coordination transport.
- **Indexer enrichment** — optional history/identity data behind a single privacy gate (ADR-0010); never authoritative for money.

## Folder map

```
xx-wallet/                     # workspace root (public repo + local-only internal folders)
├── CLAUDE.md, PROJECT_STATE.md, PROJECT_DOCTRINE.md, SECURITY.md
├── gates/                     # mechanical enforcement (pre-commit, commit-msg, xx-wallet-boundary)
├── docs/                      # public docs: ARCHITECTURE, design docs, adr/, GAP_REPORT
└── xx-wallet-mobile/          # the app
    ├── public/                # PWA assets, _headers (CSP etc. — T2)
    └── src/
        ├── api/               # provider, constants (T2), xx types
        ├── keyring/           # ALL key material (T2)
        ├── cmix/              # messaging engine (identity/credential files T2)
        ├── ledger/            # hardware signing (T2)
        ├── store/             # zustand stores
        ├── hooks/             # incl. useTx* signing paths (T2)
        ├── screens/           # route-level UI
        ├── components/        # shared UI
        ├── notifications/     # pluggable notification scaffold + receive hooks
        ├── staking/ governance/ utils/
```

## Hard rules — do not change without asking

1. **`xx-wallet-mobile/src/api/constants.ts`** — chain-baked values (SS58, decimals, RPC URLs, `XX_GENESIS_HASH` for cross-wallet keystore compat). Wrong values silently break things. Economic parameters (e.g. existential deposit) are read from the chain at runtime, never hardcoded (ADR-0009).
2. **`xx-wallet-mobile/src/keyring/store.ts`** — `manualScryptDecrypt` and the async `unlock()` path are load-bearing for `wallet.xx.network` v3 keystore compatibility (N=131072 vs Polkadot's default N=32768; ADR-0001). A missed `await` on `unlock()` yields the diagnostic `Decoding [object Promise]: Invalid base58 character "[" (0x5b) at index 0`.

## THE RULE (boundary invariant — crossing it makes a change ≥ T1)

Two facets, one gate (`gates/xx-wallet-boundary`):

1. **Decode-from-bytes (ADR-0002):** no signing or approval surface renders a description it didn't decode from call bytes verified against the on-chain hash. Depositor-, sender-, or file-supplied text is never the narrative. Applies to preimages, governance descriptions, and cMix-delivered coordination payloads alike.
2. **Keyring isolation (ADR-0003):** key material and keystore operations stay in `src/keyring/`; nothing else imports `@polkadot/keyring` or handles decrypted key bytes.

## Risk tier map (doctrine §3; full rationale in docs/GAP_REPORT.md axis 7)

- **T2 (critical):** `src/keyring/**`, `src/utils/decodeCall.ts`, `src/utils/bytesPackage.ts`, `src/hooks/useTx*.ts` + tx submission paths, `src/ledger/**`, `src/cmix/{storageSecret,identity,identityExport,deviceKey,contactBinding}.ts`, `src/api/constants.ts`, `src/utils/pin.ts`, `src/utils/webauthn.ts`, `public/_headers`, deploy configuration.
- **T1 (boundary):** multisig propose/approve/share, Send/recipient handling, cMix transport (`e2e.ts`, `messaging.ts`, `session.ts`, `store/cmix*`, receive/resend hooks), contact import/QR/config-JSON parsing, staking + governance tx screens, Settings RPC-endpoint validation.
- **T0 (routine):** presentational components, copy, formatting utils, docs, read-only views without external input.

Tier UP when unsure. Anything importing/wrapping crypto, keys, or signing is T2 until proven otherwise.

## Gates / definition of done (by tier)

- **T0:** typecheck + tests green; ledger (`PROJECT_STATE.md`) updated.
- **T1:** all T0 + independent review PASS + ADR (or `ADR: none` with reason) + boundary gate clean.
- **T2:** all T1 + a non-AI check recorded (`Non-AI-Check:` trailer: test-vectors / audit-tool / human-review / static-analysis) + rollback noted.
- Project specifics: `npm run typecheck` and `npx vitest run` green **before** any commit block is handed over; commits carry `Tier:` trailers (enforced by `gates/commit-msg`); secret scan via `gates/pre-commit` (never overridable); tests are required for security-critical pure logic (decoders, hash gates, derivation, keystore round-trips) — UI screens are not unit-tested.
- Release flow (ADR-0016): commits land on **`beta`** (auto-deploys to the beta preview URL); production ships only by **beta→main PR** with the CI `checks` job green — `main` rejects direct pushes, no bypass. The PR description carries the T1+/T2 review record.

## Conventions

- Vertical slices that ship something useful end-to-end, not horizontal scaffolding. Spike against the live chain before building on any new pallet surface.
- xx v206 codec rules (ADR-0012): enums via `.toJSON()`, structs via named fields, never tuple destructure; mangle-guard anything address-shaped (xx addresses start with "6").
- Address names always paired with a truncated SS58 fragment — substitution must never hide what's being signed.
- Substrate-canonical terminology in user-facing strings ("call data", "call hash", "extrinsic", "deposit").
- Refuse vs. warn: integrity violations refuse outright; risk-to-self gets a warning + explicit acknowledgement (ADR-0015).
- Mobile text floor 12px; body prose `text-sm`; never `text-ink-500` for visible text, `text-ink-400` only for icons/large text (WCAG AA).
- Errors surfaced on screen: render `error.message` under the friendly copy — mobile PWAs have no console.
- Pre-commit: read `git status` first, stage explicit paths (never `git add -A`), cross-check `.gitignore` after structural changes.

## Riskiest areas

The keystore/signing chain (`keyring/` → `useTx` → screens), the decode-or-refuse surfaces (`decodeCall`/`bytesPackage` and everything that renders them), messaging credentials (`cmix/`), and the deploy pipeline (push access to `main` is deploy access to a live wallet). See `SECURITY.md` for the full threat model, including what is deliberately out of scope.

## Working environment

The project lives in WSL2 (`~/projects/xx-wallet` from a WSL shell; `\\wsl.localhost\ubuntu\home\awelwood\projects\xx-wallet` as a UNC path for Cowork file tools). The Cowork bash sandbox does NOT reach UNC paths — shell commands (typecheck, tests, git, builds) are run by the Owner in a WSL terminal; always hand them over with `cd <path>` embedded, in one block. Wait for typecheck/test output and confirm green BEFORE handing over a commit block.

## Pointers

- Live status: `PROJECT_STATE.md`
- Decisions: `docs/adr/` (index in its README)
- Audit baseline: `docs/GAP_REPORT.md`
- Threat model: `SECURITY.md`
- Multisig design + §6.4/§7.3 invariants: `docs/PHASE_2A_MULTISIG_DESIGN.md` (internal, local-only — the invariants are public as ADR-0002/0003)
- Process/rulebook: `PROJECT_DOCTRINE.md`; reviewer packet: `templates/REVIEWER_PACKET.md`; gates: `gates/`
