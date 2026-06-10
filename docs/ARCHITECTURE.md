# Architecture

How xx Wallet Mobile is put together and the reasoning behind the major decisions. This is the
orientation doc for contributors; pair it with [CONTRIBUTING.md](../CONTRIBUTING.md).

## Shape of the project

The wallet is a standalone, client-only single-page app. There is no backend of its own: it talks
directly to an xx network RPC node for chain state and signing, and to the public xx network indexer
for history and identity enrichment. Everything — including key generation and signing — happens in
the browser.

```
xx-wallet/
├── docs/                 Architecture and contributor docs
├── xx-wallet-mobile/     The wallet application
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
├── scripts/
│   └── spikes/           Live-chain feasibility scripts kept as executable documentation
├── src/
│   ├── api/              @polkadot/api connection singleton, xx network constants, identity lookup
│   ├── keyring/          Encrypted on-device key storage and the Sleeve TS wrapper
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
per-account detail, settings, multisig (including the guided two-device-approval setup), staking,
and governance.

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

### Verify extrinsic signatures against the live chain
xx network forks several Substrate pallets and changes call signatures. The discipline is to
construct any new extrinsic against the real chain in a spike before designing the screen around it —
a call that builds is proof of the right signature; one that throws at construction is caught half an
hour early instead of at submit time. The spikes stay in `scripts/spikes/`.

### Defensive decoding
On the xx runtime, some auto-generated codec accessors and tuple destructures silently return wrong
values. The codebase reads enums via `.toJSON()` and structs by named field, guards decoded addresses
(they start with "6"), and treats some "balance" runtime constants as optionally present.

### Access lock is separate from signing
The optional app lock — a PIN, with fingerprint/face unlock layered on where the device supports it
— is an access gate only, off by default. It gates *opening* the app for privacy on a shared or lost
phone and never participates in signing: the keys stay encrypted with the per-account password
regardless, so the lock is a convenience, not a fund control. Real second-factor protection over
funds comes from multisig — including the guided two-device-approval flow, which produces a 2-of-3
"protected account" the chain itself enforces.

## Trust model for what gets signed

A consistent rule runs through multisig, preimages, and governance: **the human-readable summary is
always decoded from the actual call bytes, never from a description the proposer supplied**, and the
recomputed hash is checked against what the chain stores. If decode fails or the hash doesn't match,
the wallet fails closed with a clear error rather than showing a degraded or assumed summary.
Wherever an address appears it's rendered as a resolved name paired with a truncated address fragment,
so a friendly label can't disguise the underlying account. Transactions that could be signed by more
than one of the user's keys always present an explicit signer picker.

## Notifications

Notifications are a **pluggable scaffold, not a shipped channel.** The wallet defines a typed event
union (multisig, transfer, staking-slash, and governance events), a consumer "sink" interface, and a
registry with persisted de-duplication. By default it runs with a no-op sink plus an in-wallet sink
that surfaces slash and similar alerts directly inside the app — so the wallet is fully usable with no
external service connected. Channels like a Telegram bot or the browser Notification API plug in
additively by registering a sink and switching on the event kind.

## Deployment

The production app at [mobile.xx.network](https://mobile.xx.network) is a static-assets-only
Cloudflare Worker, configured in `wrangler.toml` and deployed on push to `main`:

1. Cloudflare clones the repo.
2. The Worker's root directory is `xx-wallet-mobile`.
3. `npm install && npm run build` produces `xx-wallet-mobile/dist/`.
4. `wrangler deploy` uploads `dist/` as static assets.

Single-page-application routing and trailing-slash handling are set in `wrangler.toml`; the custom
domain and TLS are provisioned through Cloudflare DNS.

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
