<div align="center">

<img src="xx-wallet-mobile/public/brand/icon-color.svg" alt="xx Wallet Mobile" width="96" height="96" />

# xx Wallet Mobile

**A mobile-first, non-custodial Progressive Web App wallet for the [xx network](https://xx.network) blockchain.**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8.svg)](https://mobile.xx.network)
[![Built with React + Vite](https://img.shields.io/badge/React_18-Vite-06b6d4.svg)](#tech-stack)
[![Chain: xx network](https://img.shields.io/badge/chain-xx_network-08cdd7.svg)](https://xx.network)

[**Open the wallet → mobile.xx.network**](https://mobile.xx.network)

</div>

---

xx Wallet Mobile is a focused, phone-first companion to the official desktop-first
[wallet.xx.network](https://wallet.xx.network) — the same chain and the same primitives, built
for the smaller screen. It runs entirely in your browser, holds your keys on your own device,
talks to no backend of its own, and can be installed to your home screen and used offline.

It covers the full surface a day-to-day xx network user needs from a phone: accounts, transfers,
the complete staking lifecycle (nominator **and** validator), the full Gov1 governance surface,
and native multisig — with quantum-resistant key generation on by default.

> [!IMPORTANT]
> **Unofficial project.** This is an independent, community-built wallet. It is **not** an
> official xx network or xx Foundation product and is not endorsed by them. It interacts with
> the public xx network chain the same way any wallet does.
>
> **Self-custody, your responsibility.** The wallet is non-custodial — you alone hold your keys
> and recovery phrases. There is no password reset and no way to recover lost phrases.
>
> **Not independently audited.** The code has not yet had a third-party security audit. Treat it
> as experimental and use it at your own risk. See [Security](#security) and [`SECURITY.md`](SECURITY.md).

---

## Screenshots

> _Screens: Dashboard · Send · Staking · Governance. (Add exported device screenshots to
> `docs/screenshots/` and link them here — a short demo GIF works well too.)_

<!--
| Dashboard | Staking | Governance |
| --- | --- | --- |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Staking](docs/screenshots/staking.png) | ![Governance](docs/screenshots/governance.png) |
-->

---

## Features

### Accounts & keys
- **Quantum-resistant by default.** New wallets are created with [Sleeve](https://sleeve.xx.network),
  which produces a standard mnemonic for everyday use plus a quantum-secure master phrase to roll
  over to once xx network adopts post-quantum identities on chain. Generation runs entirely
  in-browser with no network calls.
- **Import anything xx.** Restore from a mnemonic or from a JSON keystore — including v3 keystores
  exported by `wallet.xx.network`, which use a stronger scrypt setting that the standard libraries
  reject and this wallet handles directly.
- **Multiple accounts** with rename, encrypted export, and a batch export that imports cleanly into
  the official desktop wallet.

### Send & receive
- Sends use `transferKeepAlive` so you can't accidentally reap your own account, with a live
  signing → broadcasting → in-block → finalized status flow.
- A built-in address book lives right in the Send screen, with on-chain identity lookup, batch
  import/export, existential-deposit warnings, a Max button that leaves room for fees, and a
  self-send guard.
- Receive by QR or shareable address, with fallbacks that work even on plain HTTP.

### Staking
- **Nominate** in a single signature — pick validators yourself or let the built-in
  sequential-Phragmén recommender choose a balanced set from live chain state.
- **Manage** an existing position: add to your stake, change validators, or stop nominating.
- **Unbond and withdraw** with the 28-day lock surfaced up front and per-chunk countdowns.
- **Run a validator** end to end: set commission, manage your cMix node identity, and convert a
  nominating account to a validating one.
- **Stay informed**: a network-wide validator list, per-validator detail with on-chain identity and
  history, a personal rewards history, and slash alerts that give you time to react.

### Governance
xx network runs Substrate's first-generation governance (Gov1). The wallet mirrors the official web
wallet's governance surface, consolidated for mobile:
- **Read** every surface — bounties, democracy and stored preimages, council and technical
  committee, treasury and tips, plus a personal "My Governance" dashboard.
- **Participate** — vote on referenda (with a conviction picker and live vote-power preview), second
  public proposals, delegate and undelegate voting power, remove votes, release matured locks,
  propose treasury spends, and propose bounties.
- **Verify what you sign** — preimages and proposals are decoded locally from their on-chain bytes,
  never from proposer-supplied descriptions. Addresses everywhere show a resolved name *and* a
  truncated address fragment so a friendly label can't disguise what's actually being signed.

### Multisig
- Add a multisig by manual entry, config import (file / QR / paste), or by scanning the chain for
  ones you're part of — every path re-derives the address locally and refuses a mismatch.
- Propose and approve calls with hash-gated decoding from real call bytes, share call data with
  cosigners offline (file / QR / share sheet / paste), and reclaim deposits from your own stale
  proposals. No central server is required for any of it.

### Security & privacy
- Non-custodial. No backend, no telemetry, no analytics, no third-party scripts.
- Keys are stored encrypted on-device and decrypted only momentarily to sign.
- The Sleeve key-generation module is integrity-checked at runtime against a build-time hash.
- Ships with a Content Security Policy, HSTS, and related hardening headers.

### Installable PWA
- Add to your home screen and launch like a native app.
- The app shell — including the key-generation module — is precached, so the wallet works offline,
  account creation included.

---

## Tech stack

- **[React 18](https://react.dev) + [TypeScript](https://www.typescriptlang.org) + [Vite](https://vitejs.dev)** — app shell and build.
- **[Tailwind CSS](https://tailwindcss.com)** — styling, with custom xx network brand tokens.
- **[Zustand](https://github.com/pmndrs/zustand)** — local state, persisted for accounts, contacts, and settings.
- **[@polkadot/api](https://github.com/polkadot-js/api)** — chain interaction.
- **[vite-plugin-pwa](https://vite-pwa-org.netlify.app)** — service worker and installable shell.
- **[scrypt-js](https://github.com/ricmoo/scrypt-js) + [tweetnacl](https://github.com/dchest/tweetnacl-js)** — the `wallet.xx.network`-compatible keystore path.
- **[Sleeve](https://github.com/xxfoundation/sleeve)** — the audited xx Foundation Go reference, compiled to WebAssembly.
- **[Vitest](https://vitest.dev)** — tests, focused on the load-bearing crypto-compatibility paths.

---

## Getting started

Requires **Node 22**. (Rebuilding the Sleeve WASM additionally needs Go 1.22+, but the compiled
artifact is committed, so day-to-day development does not.)

```bash
git clone <your-fork-or-repo-url> xx-wallet
cd xx-wallet/xx-wallet-mobile

npm install
npm run dev -- --host    # dev server, reachable from a phone on the same Wi-Fi
```

Vite prints a LAN URL when it starts — open it on your phone to test the real mobile experience.

```bash
npm run typecheck        # tsc --noEmit
npm run test:run         # run the test suite once
npm run build            # production build to dist/
npm run preview -- --host
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and conventions, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the codebase is laid out and why.

---

## Security

The wallet is non-custodial and runs entirely client-side: there is no server that can be breached
to take your funds, but you are responsible for your keys and recovery phrases.

[`SECURITY.md`](SECURITY.md) documents the full threat model — what the wallet protects against,
what it explicitly does not, the cryptographic primitives in use, and the deployment trust model
inherent to any browser-delivered wallet.

**Responsible disclosure:** if you find a vulnerability, please follow the process in
[`SECURITY.md`](SECURITY.md) rather than opening a public issue.

---

## Chain constants

Baked into the chain itself and defined in
[`xx-wallet-mobile/src/api/constants.ts`](xx-wallet-mobile/src/api/constants.ts):

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

## Roadmap

Planned and under consideration, roughly in priority order:

- **Independent third-party security audit** before any recommendation for storing significant value.
- **xxCustody account support** for treasury-style locked positions.
- **Final PWA install icons** (the current ones are placeholders).
- **Upstream collaboration** with xx Foundation where the mobile work is useful to the wider ecosystem.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first — it covers the dev
setup, coding conventions, the test expectations for security-critical code, and the PR process.
For a map of the codebase, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Acknowledgements

- The [xx network](https://xx.network) and [xx Foundation](https://xx.network/about) for the chain,
  the [Sleeve](https://github.com/xxfoundation/sleeve) reference, and the
  [staking.xx.network](https://github.com/xxnetwork/staking.xx.network) Simple Staker, from which the
  validator-selection logic is ported under Apache-2.0.
- The [Polkadot-JS](https://github.com/polkadot-js) project, whose libraries make Substrate chain
  interaction possible in the browser.

---

## License

[Apache-2.0](LICENSE) — matching the main xx network wallet.
