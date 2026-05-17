# xx-wallet-mobile

The actual wallet app. See the [repo root README](../README.md) for the full project overview, what's built, repo layout, deployment, and security model.

## Quick dev reference

```bash
npm install
npm run dev -- --host       # Dev server, LAN-accessible for phone testing
npm run typecheck            # Run tsc --noEmit
npm run test:run             # Run vitest once (use `npm test` for watch mode)
npm run build                # Production build to dist/
npm run preview -- --host    # Serve the production build locally
```

## Source layout

```
src/
├── api/             — @polkadot/api singleton, xx network constants (incl. XX_GENESIS_HASH), on-chain identity lookup
├── keyring/         — Encrypted account storage (manual scrypt N=131072); Sleeve WASM TS wrapper; verifyPassword helper
├── staking/         — seq-Phragmén pass + selectValidators top-N picker (Apache-2.0 port from staking.xx.network's simple-staking module)
├── hooks/           — useApi, useBalance, useTransfers, useTx; multisig: useMultisigActivity, usePendingMultisigs, useStaleness, useAddressName;
│                     staking: useStakingPosition, useStakingRoles, useValidatorList, useValidatorDetail, useRewardsHistory, useAutoNominate
├── store/           — Zustand stores (accounts, contacts, multisigs, pending bytes cache, settings, connection, alerts)
├── notifications/   — Pluggable scaffold (types, sink, inlineSink, registry, useMultisigNotifications, useSlashNotifications)
├── components/      — Layout (TopBar, BottomNav, AppLayout) + UI primitives (AddressChip, AddressIcon, AddressLabel, ConnectionBadge,
│                     LoadingIndicator, QrScanner, Sheet, SparkBarChart, StakingStatusBadge, TransactionItem)
├── screens/         — Onboarding, Dashboard, Send, Receive, TransactionDetail, Settings,
│                     Multisig{Create,Detail,Import,Scan,Propose,Approve,Share},
│                     Staking/ (StakingLayout, MyNominations, ValidatorList, ValidatorDetail, RewardsHistory,
│                       StartStaking, AddToStake, ChangeValidators, StopNominating, UnbondAmount, WithdrawUnbonded,
│                       ValidatorSetup, ChangeCmixId, TransferCmixId, ManageStakeSheet, ValidatorPickerSheet,
│                       RecentAlertsBanner)
├── utils/           — bytesPackage, multisigConfig, decodeCall, chainScan, address validation, balance formatting,
│                     clipboard fallback, password blocklist
└── styles/          — Tailwind layer + xx network brand tokens
```

## Sleeve WASM

The Sleeve key-generation module is built from Go in [`sleeve-wasm/`](sleeve-wasm/). Output artifacts live in [`public/sleeve/`](public/sleeve/) and are committed so day-to-day builds don't need Go installed. To rebuild after changing the Go source:

```bash
cd sleeve-wasm
./build.sh
```

## Cloudflare deployment

`wrangler.toml` at the root of this directory configures the static-assets-only Worker. Cloudflare auto-deploys on push to `main` — see the root README's Deployment section for the full pipeline.
