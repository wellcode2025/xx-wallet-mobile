# xx Wallet Mobile

A mobile-first Progressive Web App wallet for the [xx network](https://xx.network) blockchain.

**Live at:** [mobile.xx.network](https://mobile.xx.network)

Designed as a focused mobile companion to the official desktop-first [wallet.xx.network](https://wallet.xx.network) — same chain, same primitives, different surface area. Standalone, non-custodial, no backend, keys never leave the device. Sleeve quantum-resistant key generation is the default for new accounts.

---

## Status

Phase 2a — multisig + pluggable notification scaffold — complete (May 2026). Validated end-to-end on real xx network with real proposals, approvals, and cancellations against a foundation 2-of-N treasury multisig.

Phase 2b (read-only staking views) is the next major area of work.

---

## What's built

**Onboarding**

- Create wallet via Sleeve (audited xxfoundation reference, dual-mnemonic, quantum + standard).
- OPSEC step with live online/offline indicator and attestations before generation.
- Import wallet from mnemonic or JSON keystore — including v3 keystores exported by `wallet.xx.network` (which use `scrypt N=131072` and are rejected by the standard `@polkadot/util-crypto` library; we handle them via a manual scrypt path).

**Dashboard**

- Live balance breakdown (transferable / reserved / frozen) with privacy toggle.
- Multi-account switcher.
- Transaction history pulled from the official xxfoundation indexer (same source as `explorer.xx.network`).
- Identity display names from the indexer next to addresses.

**Send**

- `balances.transferKeepAlive` so the sender's account can't be reaped accidentally.
- Full lifecycle UI: signing → broadcasting → in-block → finalized.
- QR scanner with HTTP fallback to manual paste.
- Integrated address book inside the Send screen — add, edit, search, batch import/export as JSON.
- On-chain identity auto-fetch when adding contacts (display name, legal, email, web, twitter, riot, judgement badge).
- Existential-deposit warnings for both sender and recipient new-account cases.
- Max button accounts for the existential deposit so transactions don't get rejected on chain.
- Self-send guard.

**Receive**

- QR code, copy address (with HTTP fallback), share via Telegram, WhatsApp, email, or system share sheet.

**Transaction detail**

- Tap any transaction to see hash, block, era, extrinsic index, fee, tip (when non-zero), and timestamp.
- Deep link to `explorer.xx.network`.

**Settings**

- RPC endpoint: xx Foundation, Dwellir, or any custom `wss://`/`ws://` URL.
- Multi-account management: create new, import existing, rename, export keystore JSON, remove.
- Batch export accounts as a polkadot.js-compatible array (cross-compat with the official xx desktop wallet's bulk import flow, with per-account password verification up front so backups are guaranteed openable).
- Configurable stale-proposal threshold for multisigs (default 30 days).
- Live chain info (chain name, current block).

**Multisig (Phase 2a)**

- Add a multisig via three paths: manual entry, JSON config import (file / QR / paste), or user-initiated chain scan against the indexer.
- Local address derivation on every path — the wallet computes the multisig address from `(threshold, signers)` itself and refuses imports whose claimed address doesn't match.
- Propose `balances.transferKeepAlive` calls from any multisig the user is a signer of. Per-account "signed by" picker so the user explicitly chooses which key signs.
- Approve pending calls with hash + bytes verification gates — decoding is always derived from the actual call bytes, never from depositor-supplied text.
- Cancel your own pending proposals (and reclaim the deposit).
- Stale-proposal nudges past the configurable threshold.
- Share call data with cosigners via file download, QR code, native share sheet, or paste — the wallet does not depend on any central notification service to function.
- Address-book name substitution everywhere addresses appear, always paired with a truncated SS58 fragment so a familiar-looking nickname can't hide what is actually being signed.

**Notification scaffold**

- Pluggable interface in `src/notifications/`: typed `WalletEvent` discriminated union, `NotificationSink` consumer interface, and a registry with localStorage-persisted dedupe.
- Ships with a no-op default sink — the wallet works fully in "no notification service connected" mode.
- Plugins (Telegram channels, browser Notification API, downstream integrations like OpenClaw) plug in additively by registering a sink and switching on `event.kind`.

**PWA**

- Installable to home screen.
- Service worker precaches the entire app shell including the Sleeve WASM, so the wallet works fully offline once installed — including new account generation.
- Brand-aligned with the official xx network style guide (Roboto display, Helvetica Neue body, brand teal `#08cdd7`).

---

## Tech stack

- **Vite** + **React 18** + **TypeScript** for the app shell.
- **Tailwind** for styling, with custom xx-network brand tokens.
- **Zustand** with `persist` for local state (accounts, contacts, settings).
- **@polkadot/api** + **@polkadot/keyring** for chain interaction.
- **vite-plugin-pwa** for the service worker and installable shell.
- **scrypt-js** + **tweetnacl** for the wallet.xx.network-compatible scrypt path.
- **Sleeve** via WebAssembly: the audited [xxfoundation/sleeve](https://github.com/xxfoundation/sleeve) Go reference compiled to WASM and called from JS — same pattern xxfoundation themselves use in [their walletgen example](https://github.com/xxfoundation/scripts/tree/main/walletgen).
- **Vitest** for tests, primarily covering the load-bearing scrypt + Sleeve compatibility paths.

---

## Repo layout

```
xx-wallet/
├── docs/                       — Architecture and migration notes
├── xx-wallet-mobile/           — The wallet app
│   ├── public/
│   │   ├── brand/              — xx network logo SVGs (color + white)
│   │   ├── icons/              — Favicon + PWA install icons
│   │   └── sleeve/             — Compiled Sleeve WASM + Go runtime helper
│   ├── sleeve-wasm/            — Go source for the Sleeve WASM (built artifacts in public/sleeve/)
│   ├── src/
│   │   ├── api/                — @polkadot/api wrapper + xx-network constants (incl. XX_GENESIS_HASH)
│   │   ├── keyring/            — Encrypted local key storage + Sleeve TS wrapper
│   │   ├── hooks/              — useApi, useBalance, useTx, useTransfers, useMultisigActivity, usePendingMultisigs, useStaleness, useAddressName
│   │   ├── store/              — Zustand stores (accounts, address book, multisigs, pending bytes cache, settings)
│   │   ├── notifications/      — Pluggable notification scaffold (types, sink, registry, useMultisigNotifications)
│   │   ├── components/
│   │   ├── screens/            — Onboarding, Dashboard, Send, Receive, TransactionDetail, Settings, Multisig{Create,Detail,Import,Scan,Propose,Approve,Share}
│   │   └── utils/              — bytesPackage, multisigConfig, decodeCall, chainScan, address/format helpers
│   └── wrangler.toml           — Cloudflare Workers static-assets deploy config
└── README.md                   — You are here
```

---

## Local development

Requires Node 22 (Sleeve WASM build also requires Go 1.22+; the WASM artifact is committed so day-to-day builds don't need Go).

```bash
# From the repo root
cd xx-wallet-mobile

# Install
npm install

# Dev server (LAN-accessible for phone testing)
npm run dev -- --host

# Type check
npm run typecheck

# Tests
npm run test:run

# Production build
npm run build

# Preview the production build
npm run preview -- --host
```

Vite prints a Network URL when started; on the same Wi-Fi as your dev machine, you can open it on a phone to test the actual mobile experience.

### Rebuilding the Sleeve WASM (rare)

The compiled `public/sleeve/main.wasm` is committed. You only need Go installed when changing `sleeve-wasm/main.go` or bumping the upstream `xx-labs/sleeve` dependency:

```bash
cd xx-wallet-mobile/sleeve-wasm
./build.sh
```

That re-runs `go mod tidy`, copies the matching `wasm_exec.js` runtime helper from your Go installation, and writes both into `xx-wallet-mobile/public/sleeve/`.

---

## Deployment

Production deploys to Cloudflare via auto-deploy on push to `main`:

1. Cloudflare clones the repo
2. `cd xx-wallet-mobile` (the Root directory setting on the Worker)
3. `npm install && npm run build` — produces `xx-wallet-mobile/dist/`
4. `npx wrangler deploy` — reads `wrangler.toml`, uploads `dist/` as static assets to the existing Worker

The `wrangler.toml` configures the Worker as a static-assets-only deployment with:

- `not_found_handling = "single-page-application"` so React Router handles deep links.
- `html_handling = "auto-trailing-slash"` for consistent URL behaviour.

Custom domain `mobile.xx.network` is mapped via Cloudflare DNS (the parent zone is on Cloudflare, so the CNAME and TLS certificate provision automatically).

---

## Security model

- Private keys are stored encrypted in `localStorage` with the user's password, in the same PKCS#8-wrapped format the official wallet uses for exported keystores. Keys are decrypted only transiently during signing, then re-locked.
- Sleeve quantum mnemonics are shown to the user once during onboarding and are **never stored anywhere in the wallet** — the user's external backup is the only copy. This matches the contract of [sleeve.xx.network](https://sleeve.xx.network).
- The wallet runs entirely in the browser. No backend, no telemetry, no analytics, no third-party scripts.
- Generation makes no network calls — the OPSEC step in onboarding makes this visible to the user and recommends disconnecting from the internet for maximum protection against compromised browser extensions or screen monitoring.

---

## Chain constants

These are baked into the chain itself and live in [`src/api/constants.ts`](xx-wallet-mobile/src/api/constants.ts):

| Item | Value |
| --- | --- |
| SS58 prefix | 55 (addresses start with "6") |
| Decimals | 9 |
| Token symbol | XX |
| Block time | 6 seconds |
| Finality | ~18 seconds (3 blocks) |
| Existential deposit | 0.001 XX |
| Default RPC | `wss://rpc.xx.network` |
| Indexer | `https://indexer.xx.network/v1/graphql` |

---

## License

Apache-2.0, matching the main xx network wallet.
