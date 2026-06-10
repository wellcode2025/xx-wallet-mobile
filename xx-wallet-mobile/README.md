# xx-wallet-mobile

The wallet application. For the project overview, features, security model, and screenshots, see the
[repo root README](../README.md). For how the code is organized and the design rationale, see
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md). To contribute, see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Requirements

- **Node 22**
- **Go 1.22+** only to rebuild the Sleeve WASM (the compiled artifact is committed, so normal
  development does not need Go)

## Dev quick reference

```bash
npm install
npm run dev -- --host        # dev server, LAN-accessible for phone testing
npm run typecheck            # tsc --noEmit
npm run lint                 # ESLint
npm run test:run             # run the test suite once (npm test for watch mode)
npm run build                # production build to dist/
npm run preview -- --host    # serve the production build
```

Vite prints a Network URL on start — open it on a phone on the same Wi-Fi to test the real mobile
experience. Camera, clipboard, and Web Share APIs require HTTPS, so on a plain-HTTP dev URL the app
falls back to manual alternatives.

## Source layout

A short tour lives in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md). In brief:

```
src/
├── api/             @polkadot/api singleton, xx network constants, on-chain identity lookup
├── keyring/         Encrypted account storage and the Sleeve WASM wrapper
├── staking/         Sequential-Phragmén pass + validator selection
├── governance/      Cross-cutting Gov1 utilities
├── hooks/           Data + compute hooks for balances, staking, multisig, governance
├── store/           Zustand stores (accounts, contacts, multisigs, settings, alerts, app-lock)
├── notifications/   Pluggable notification scaffold
├── components/      Layout and UI primitives
├── screens/         One folder per feature area
├── utils/           Byte/call decoding, multisig config, address & balance helpers
└── styles/          Tailwind layer + xx network brand tokens
```

## Sleeve WASM

Built from Go in [`sleeve-wasm/`](sleeve-wasm/); artifacts in [`public/sleeve/`](public/sleeve/) are
committed. To rebuild after changing the Go source:

```bash
cd sleeve-wasm
./build.sh
```

## Deployment

`wrangler.toml` configures the static-assets-only Cloudflare Worker; Cloudflare auto-deploys on push
to `main`. See the root README's Deployment section and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
for the full pipeline.
