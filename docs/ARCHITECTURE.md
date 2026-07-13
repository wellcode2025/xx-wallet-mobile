# Architecture

How xx Wallet Mobile is put together and the reasoning behind the major decisions. This is the
orientation doc for contributors; pair it with [CONTRIBUTING.md](../CONTRIBUTING.md). The *why*
behind each material decision is recorded one file per decision in [`docs/adr/`](adr/); the
engineering process itself (risk tiers, review, gates) is in
[`PROJECT_DOCTRINE.md`](../PROJECT_DOCTRINE.md).

## Shape of the project

The wallet is a standalone, client-only single-page app. There is no backend of its own: it talks
directly to an xx network RPC node for chain state and signing, to the public xx network indexer
for history and identity enrichment, and — for the opt-in messaging feature — to the xx network
mixnet itself via an in-browser cMix client. Everything, including key generation and signing,
happens in the browser.

```
xx-wallet/
├── docs/                 Architecture and contributor docs; decision records in docs/adr/
├── gates/                Mechanical enforcement scripts (secret scan, tier trailers, boundary)
├── xx-wallet-mobile/     The wallet application
├── PROJECT_DOCTRINE.md / CLAUDE.md / PROJECT_STATE.md
└── README.md / SECURITY.md / CONTRIBUTING.md / LICENSE
```

## Application layout

```
xx-wallet-mobile/
├── public/
│   ├── brand/            xx network logo SVGs (color + white)
│   ├── icons/            Favicon and PWA install icons
│   └── sleeve/           Compiled Sleeve WASM + Go runtime helper (committed)
├── sleeve-wasm/          Go source for the Sleeve module (built artifacts live in public/sleeve/)
├── worker/               Cloudflare Worker entry: serves dist/ + proxies /xxdk-wasm/* same-origin
├── src/
│   ├── api/              @polkadot/api connection singleton, xx network constants, identity
│   │                     lookup, and the gated indexer client (see "Privacy toggle" below)
│   ├── keyring/          Encrypted on-device key storage and the Sleeve TS wrapper; accounts are
│   │                     a discriminated union of local (keystore) and Ledger (device) records
│   ├── cmix/             Messaging engine: cMix session/follower, per-account e2e identities,
│   │                     contact bindings, coordination + chat wire formats (see "Messaging")
│   ├── ledger/           Ledger hardware-wallet transport + device signer, fully lazy-loaded
│   ├── staking/          Sequential-Phragmén pass and validator-selection scoring
│   ├── governance/       Cross-cutting Gov1 utilities (identity resolver, forum-link parsing,
│   │                     block→time countdowns, period-progress, pallet-account derivation)
│   ├── hooks/            Data hooks: balances, transfers, transactions, and the staking,
│   │                     multisig, and governance read/compute logic
│   ├── store/            Zustand stores (accounts, address book, multisigs, settings, alerts,
│   │                     app-lock, cached call-bytes)
│   ├── notifications/    Pluggable notification scaffold (see "Notifications" below)
│   ├── components/       Layout and UI primitives, plus the shared transaction footer
│   ├── screens/          One folder per feature area
│   ├── utils/            Byte/call decoding, multisig config, address & balance helpers
│   └── styles/           Tailwind layer + xx network brand tokens
├── wrangler.toml         Cloudflare static-assets deploy config
└── package.json
```

The feature areas under `screens/` are: onboarding, dashboard, send, receive, transaction detail,
per-account detail, connect-Ledger, settings, multisig (including the guided two-device-approval
setup), staking, governance, and Memos (private messaging + multisig coordination).

## Tech choices and why

- **React + TypeScript + Vite.** Standard, fast, and well supported by the Polkadot-JS ecosystem.
- **Zustand with persistence** for accounts, contacts, and settings — small, unopinionated, and easy
  to reason about for sensitive state.
- **npm, not yarn.** Yarn v1's hoisting interacts badly with the `@polkadot` packages.
- **Tailwind** with a custom `xx-*` brand palette and an `ink-*` neutral scale, dark theme only.

## Key design decisions

### Standalone, client-only, non-custodial
No server means no server to breach for funds, and the whole app is inspectable in the browser. The
tradeoff — that whoever controls the served code controls the app — is inherent to any
browser-delivered wallet and is documented in [SECURITY.md](../SECURITY.md).

### Sleeve is the default for new accounts
New wallets are generated with the audited xx Foundation [Sleeve](https://github.com/xxfoundation/sleeve)
reference, compiled from Go to WebAssembly and called from TypeScript. It produces a standard
mnemonic — which feeds the normal sr25519 derivation so the resulting address matches what
`wallet.xx.network` produces from the same phrase — plus a quantum-secure master phrase shown once and
never stored. The WASM is integrity-checked at runtime against a hash baked in at build time.

### Compatible with `wallet.xx.network` keystores
The official desktop wallet exports v3 keystores using a stronger scrypt cost than the standard
libraries expect, and those libraries reject them outright. The keyring implements a manual
decrypt/encrypt path that reads the scrypt parameters from the file itself, so keystores move both
directions between the two wallets. This path is load-bearing and bounded against malicious
parameters; treat it as critical code.

### Chain-first, indexer-for-enrichment
Block scanning over RPC is too slow for a mobile history view, so transaction history comes from the
indexer. But not every indexer table tracks current chain state, so anything that drives an *action*
(balances, the elected validator set, voting state) reads from the chain as the source of truth, and
the indexer is used for enrichment (names, historical charts) behind an "As of <date>" frame. Each
data source is validated with a spike script before a screen depends on it.

### Privacy toggle: the indexer is optional
The indexer sees the requesting IP and the addresses being queried, so a Settings toggle lets users
opt out entirely. Every indexer query flows through one gate (`src/api/indexer.ts`) that refuses
locally — before any network IO — when the toggle is off; a privacy setting that still leaks on some
code path would be worse than none. The affected views then explain what's missing and why instead
of failing generically, multisig chain-scan is blocked up front (the scan itself would transmit the
user's addresses), and identity names fall back to direct chain lookups. Nothing that signs or
moves funds ever depended on the indexer.

### Hardware accounts: the key never enters the browser
A Ledger-backed account stores only an address and a BIP44 derivation path; signing serializes the
extrinsic payload to the device, where the user reads the decoded call on the Ledger's own screen
and physically confirms. Three disciplines follow from taking the device display seriously:
addresses must be confirmed on the device before the wallet stores them; calls the Ledger xx
network app cannot decode and display (multisig, governance democracy) are refused in the wallet
rather than blind-signed; and flows the app can't sign as one batch (bond+nominate and similar) run
as clearly-labeled sequential device approvals instead. Transports are WebHID on desktop Chromium
and WebUSB on Android Chrome over a USB cable — capability-gated, so platforms without the APIs
(iOS, Firefox) never see the feature. Bluetooth is deliberately not offered: Web Bluetooth to a
Nano X on Android fails at the bonding step with a long-standing upstream issue, and a connect
option that fails for most phones costs more trust than it buys. The transport stack is
lazy-loaded, so users who never touch a Ledger never download it.

### Verify extrinsic signatures against the live chain
xx network forks several Substrate pallets and changes call signatures. The discipline is to
construct any new extrinsic against the real chain in a spike before designing the screen around it —
a call that builds is proof of the right signature; one that throws at construction is caught half an
hour early instead of at submit time.

### Defensive decoding
On the xx runtime, some auto-generated codec accessors and tuple destructures silently return wrong
values. The codebase reads enums via `.toJSON()` and structs by named field, guards decoded addresses
(they start with "6"), and treats some "balance" runtime constants as optionally present.

### Access lock is separate from signing
The optional app lock — a PIN, with fingerprint/face unlock layered on where the device supports it
— is an access gate only, off by default. It gates *opening* the app for privacy on a shared or lost
phone and never participates in signing: the keys stay encrypted with the per-account password
regardless, so the lock is a convenience, not a fund control. Real second-factor protection over
funds comes from controls outside the app's reach: multisig — including the guided
two-device-approval flow, which produces a 2-of-3 "protected account" the chain itself enforces —
or a Ledger hardware account, where the key lives in the device's secure element.

## Trust model for what gets signed

A consistent rule runs through multisig, preimages, and governance: **the human-readable summary is
always decoded from the actual call bytes, never from a description the proposer supplied**, and the
recomputed hash is checked against what the chain stores. If decode fails or the hash doesn't match,
the wallet fails closed with a clear error rather than showing a degraded or assumed summary.
Wherever an address appears it's rendered as a resolved name paired with a truncated address fragment,
so a friendly label can't disguise the underlying account. Transactions that could be signed by more
than one of the user's keys always present an explicit signer picker. Ledger accounts extend the
same rule to hardware: the device screen is the final authority on what gets signed, so anything the
device can't display, the wallet won't ask it to sign.

## Messaging (Memos)

Messaging is opt-in and default-off, and exists first for **multisig coordination**: sending a
proposal's call data to cosigners over the xx mixnet instead of a Telegram back-channel. The
architecture (each point recorded as an ADR):

- **One cMix client, one network follower**, hosting a **separate reception identity per wallet
  account** — accounts stay unlinkable through messaging, and a conversation's sender identity is
  fixed for its lifetime (ADR-0005). The heavy xxdk WASM (~40 MB) loads lazily, and only for users
  who enable messaging; the browser fetches it same-origin via the Worker proxy.
- **Contacts are account-signed bindings**: the wallet verifies the wallet-account key signed the
  (account ⟷ cMix identity) binding before storing, and incoming channel requests are auto-accepted
  only from known contacts, matched by canonical reception ID (ADR-0007).
- **A memo is transport, never instruction**: coordination payloads received over the mixnet are
  cached and re-validated against the on-chain call hash before anything reaches an approval
  surface — the same decode-from-bytes rule as every other input path (ADR-0002/0006).
- **Credentials**: all identities are wrapped under one storage secret, scrypt-protected by a
  dedicated messaging passphrase (never a wallet password, never a signing factor), with an
  optional non-extractable device-key wrap for one-tap reconnect and encrypted multi-identity
  backup/restore (ADR-0006).
- **Delivery is engineered, not assumed**: identities log in and buffering listeners register
  *before* the network follower starts (the cold-resume ordering contract, ADR-0008), receipts
  confirm actual delivery, un-acked memos re-send automatically while online, and messages to
  offline recipients are held encrypted by network gateways (~21 days) for pickup on next open.

## Notifications

Notifications are a **pluggable scaffold, not a shipped channel.** The wallet defines a typed event
union (multisig, transfer, staking-slash, and governance events), a consumer "sink" interface, and a
registry with persisted de-duplication. By default it runs with a no-op sink plus an in-wallet sink
that surfaces slash and similar alerts directly inside the app — so the wallet is fully usable with no
external service connected. Channels like a Telegram bot or the browser Notification API plug in
additively by registering a sink and switching on the event kind.

## Deployment and release channels

The production app at [mobile.xx.network](https://mobile.xx.network) is a Cloudflare Worker: the
entry in `worker/index.ts` serves the built `dist/` as static assets (with SPA routing fallback)
and proxies `/xxdk-wasm/*` server-side, keeping the large messaging WASM same-origin and off the
static-asset size cap. Configuration lives in `wrangler.toml`; the custom domain and TLS are
provisioned through Cloudflare DNS.

Releases run on two channels (ADR-0016):

- **`beta`** is the integration branch. Every push is built by the GitHub-connected Cloudflare
  Workers Build and served as a preview with a stable branch alias — a live beta wallet on its own
  origin (so its browser storage is fully separate from production).
- **`main`** is production. It rejects direct pushes for everyone; changes arrive only by
  beta→main pull request with the CI workflow green. CI mirrors the repo's local gates: typecheck,
  the full test suite, an architectural boundary check (`gates/xx-wallet-boundary`), and a
  full-history secret scan.
- On a merge to `main`, Cloudflare builds (`npm install && npm run build` in `xx-wallet-mobile/`)
  and runs `wrangler deploy`. Installed PWAs pick the release up through the in-app update prompt
  (ADR-0013).

## Rebuilding the Sleeve WASM (rare)

The compiled module in `public/sleeve/` is committed, so normal builds don't need Go. Rebuild only
when changing the Go source or bumping the upstream Sleeve dependency:

```bash
cd xx-wallet-mobile/sleeve-wasm
./build.sh
```

That re-tidies the Go module, copies the matching `wasm_exec.js` runtime helper from your Go
installation, and writes both into `public/sleeve/`. A prebuild step re-hashes the artifact so the
runtime integrity check stays in sync.
