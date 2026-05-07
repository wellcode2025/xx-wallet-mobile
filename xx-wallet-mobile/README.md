# xx Wallet Mobile

A mobile-first Progressive Web App (PWA) wallet for the
[xx network](https://xx.network) blockchain. Designed to be a standalone
prototype that connects to the same live network as
[wallet.xx.network](https://wallet.xx.network) but with a UI/UX purpose-built
for phones.

Built as a proposal to supplement — not replace — the main web wallet.
Not yet merged into the main `xxfoundation/wallet.xx.network` repo.

## Phase 1 scope

This is Phase 1 — the foundation and core wallet features. Intentionally
limited so the architecture can be validated before building out the full
feature set.

**Included:**

- Create wallet (24-word mnemonic with backup verification)
- Import wallet (mnemonic or JSON keystore)
- Dashboard with live balance (transferable / reserved / frozen)
- Send XX with `transferKeepAlive` and full tx lifecycle (sign → broadcast → in-block → finalized)
- Receive via QR code + shareable address
- Account switching (multi-account)
- Settings: RPC endpoint switcher, export keystore JSON, remove account
- PWA: installable to home screen, works offline for cached assets

**Not yet included — coming in later phases:**

- Full Sleeve (dual-phrase quantum-secure) wallet generation
- Staking: nominations, bond/unbond, rewards
- Governance: referenda, council, treasury
- xxCustody
- Block explorer
- Transaction history
- Address book / contacts
- Hardware wallet support (Ledger)
- QR code scanner for pasting recipient addresses

## Architecture at a glance

```
src/
├── api/         — @polkadot/api connection singleton, xx-specific constants
├── keyring/     — Encrypted account storage (sr25519, localStorage-backed)
├── hooks/       — useApi, useBalance, useTx
├── store/       — Zustand stores: connection, accounts, settings
├── components/  — Layout (BottomNav, TopBar) + UI primitives
├── screens/     — Onboarding, Dashboard, Send, Receive, Settings
├── utils/       — Balance formatting, SS58 address validation
└── styles/      — Tailwind + design system
```

Key technical choices:

| Choice | Rationale |
|---|---|
| **Vite** | ~10x faster HMR than the existing Webpack setup; smaller final bundle |
| **@polkadot/api** | Same as the main wallet — Rick will recognize every pattern |
| **Zustand** | Replaces the RxJS complexity with a much simpler state model for a mobile app |
| **Tailwind** | Mobile-first by default; replaces Styled Components overhead |
| **PWA** | No app store review cycle; installable; works on any phone |
| **sr25519** | xx network's default signing scheme (Phase 1 skips Sleeve) |

## Connecting to xx network

The app connects to `wss://rpc.xx.network` by default (the official xx
foundation RPC node). A fallback to `wss://xx-network-rpc.dwellir.com` is
available in Settings.

All xx-network-specific constants live in `src/api/constants.ts`:

- SS58 prefix: **55** (addresses start with `6`)
- Decimals: **9**
- Block time: 6 seconds
- Finality: ~3 blocks / 18 seconds

## Running it locally

```bash
# Install dependencies (use yarn — the wallet.xx.network ecosystem uses yarn workspaces)
yarn install

# Start the dev server
yarn dev

# Open http://localhost:5173 on your phone (make sure phone + computer are on the same Wi-Fi;
# Vite will show the network URL in the terminal)
```

To build for production:

```bash
yarn build
yarn preview
```

## Testing with a real account (caution)

When testing, **start with a throwaway account**. The recommended flow:

1. Generate a new wallet in this app (get a fresh 24-word phrase)
2. Fund it with a small amount from the main wallet (e.g. 1 XX)
3. Test send/receive between this app and the main wallet

Do not import your primary account's mnemonic into an unreleased wallet
build. If you need to test with real funds, export the main account as JSON
keystore first so the mnemonic never leaves your laptop.

## Security notes

- Private keys are stored encrypted with the user's password, via
  `@polkadot/keyring`'s PKCS#8 JSON format — the same format the main wallet
  uses for exported accounts
- Keys are only decrypted transiently during signing, then the pair is
  immediately locked
- Keys live in `localStorage`. On a real device we should eventually move to
  the WebCrypto + Credential Management APIs for defence-in-depth
- No analytics, no telemetry, no third-party services

## Demo plan for Rick

1. Open the dev server on a phone
2. Tap "Create new wallet", walk through the 3-step onboarding
3. Receive screen: show the QR, scan it from the main wallet
4. Send a small test transaction from the main wallet to this app
5. Watch the balance update live on the Dashboard
6. Send it back, watch the full signing → finalization UI
7. Settings: switch endpoint, see chain name/block height update

If the demo goes well, the proposal is:

1. Ship this as a separate repo/domain for now (e.g. `mobile.xx.network`)
2. Eventually migrate it into the main monorepo as a new package
   (`packages/mobile`) alongside `packages/apps` and `packages/apps-electron`

## License

Apache-2.0, matching the main wallet.
