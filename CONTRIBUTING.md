# Contributing to xx Wallet Mobile

Thanks for your interest in improving the wallet. This document covers how to get set up, the
conventions the codebase follows, and what we expect from a pull request. For a map of how the code
is organized and why, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) alongside this.

## Ground rules

- **This is a non-custodial wallet — correctness and safety come before features.** A bug here can
  cost someone real funds. When in doubt, prefer the conservative, inspectable approach.
- **Be respectful.** Assume good faith, keep discussion technical, and welcome newcomers.
- **Open an issue before a large change.** For anything beyond a small fix, describe the change first
  so we can agree on the approach before you invest the time.

## Development setup

You'll need **Node 22**. Rebuilding the Sleeve WebAssembly module additionally needs **Go 1.22+**,
but the compiled artifact is committed, so you only need Go if you change the Go source.

```bash
git clone <your-fork-url> xx-wallet
cd xx-wallet/xx-wallet-mobile

npm install
npm run dev -- --host        # dev server, reachable from a phone on the same Wi-Fi
```

Useful scripts:

```bash
npm run typecheck            # tsc --noEmit
npm run lint                 # ESLint
npm run test:run             # run the test suite once (npm test for watch mode)
npm run build                # production build to dist/
npm run preview -- --host    # serve the production build
```

Because this is a mobile-first app, **test on an actual phone.** Vite prints a LAN URL on start;
open it on a device on the same network. Note that some browser APIs (camera for the QR scanner,
clipboard, Web Share) require HTTPS, so on a plain-HTTP dev URL the wallet falls back to manual
alternatives — that's expected, not a bug. Ledger work is the exception that's easiest on desktop:
`localhost` counts as a secure context, so WebHID works against `npm run dev` without a deploy.

## Conventions

### Code style
- TypeScript throughout; prefer explicit types on exported functions and module boundaries.
- React function components with hooks. Keep components focused; split a screen into sub-files once
  it's doing more than one job.
- Styling is Tailwind utility classes using the project's `xx-*` brand and `ink-*` neutral tokens.
  Don't introduce new colors without a design reason.

### Mobile accessibility (enforced)
- **12px is the minimum font size**, anywhere. Body prose is `text-sm` (14px).
- Don't use the lightest muted neutral for visible text — it fails WCAG AA contrast on the dark
  surfaces. Muted *placeholder* and *disabled* states are fine.
- Touch targets are at least ~44px.

### Talking to the chain
- **Verify call signatures against the live chain, not against Substrate docs.** xx network forks
  several pallets and changes call signatures (for example, `staking.bond` takes a cMix node id
  where upstream takes a payee). Before building any screen that submits an extrinsic, construct the
  call against the real chain in a small spike script and confirm it builds, decodes, and (where
  safe) dry-runs before writing any UI on top of it.
- **Decode storage defensively.** On the xx runtime, some auto-generated codec accessors and tuple
  destructures return wrong values silently. Read enums via `.toJSON()` and structs by named field,
  and guard decoded addresses (xx addresses start with "6"). Some runtime constants that look like a
  plain balance are actually optional — handle both shapes.
- **Spike each data source before relying on it.** Not every table in the public indexer tracks
  current chain state. Use the chain as the source of truth for anything that drives an action; use
  the indexer for enrichment, and frame possibly-stale data with an "As of <date>" label rather than
  presenting it as live.

### Trust and signing (important)
- **Decode from bytes, never from a description someone supplied.** For multisig approvals,
  preimages, and governance proposals, the summary the user sees must be derived from the actual call
  bytes, with the hash checked against what the chain stores. If decoding fails or a hash doesn't
  match, fail closed with a clear message — never show a degraded or assumed summary.
- **Always show a name *and* a truncated address together.** A resolved nickname must never be able
  to hide which address is actually involved.
- **Never sign silently as the active account.** Where a transaction could be signed by more than one
  of the user's keys, present an explicit signer picker.
- **Surface the real error.** Mobile browsers have no easy console; render the underlying error
  message on the error UI so problems are diagnosable in the field.

### Accounts aren't always keystores
Accounts are a discriminated union: local accounts carry an encrypted keystore, Ledger accounts
carry only an address and derivation path. Any code that assumes "account ⇒ keystore ⇒ password"
must branch on the account's `source` (the keyring's type guards exist for this). When adding
anything signing-adjacent, decide explicitly what a Ledger signer does there: device signing where
the Ledger xx network app supports the call, an honest visible explanation where it doesn't —
never silent absence, and never blind signing.

### Do not change without discussion
- `xx-wallet-mobile/src/api/constants.ts` — chain-baked values (SS58 prefix, decimals, genesis
  hash, RPC URLs). Wrong values silently break things. Economic parameters like the existential
  deposit are deliberately *not* here — they're read from the chain at runtime.
- `xx-wallet-mobile/src/keyring/store.ts` — the manual scrypt decrypt/encrypt path and the async
  `unlock()` flow. This is load-bearing for compatibility with `wallet.xx.network` keystores; changing
  it carelessly breaks the ability to import and sign with existing wallets.
- `xx-wallet-mobile/public/_headers` — the security headers, and in particular the
  Permissions-Policy allowlist: `usb=(self), hid=(self)` is what lets Ledger connections work at
  all, and everything else is deliberately denied. A new device-API feature needs an allowlist
  entry here, and a denied entry must stay denied unless there's a reason as strong as Ledger's.
- Indexer access goes through `src/api/indexer.ts`, never a direct `fetch` — the single gate is
  what makes the Settings privacy toggle airtight.

## Tests

We use [Vitest](https://vitest.dev). The expectation is **tests accompany security-critical pure
logic** as it's written, rather than as a separate later effort:

- Key storage and keystore round-trips, address derivation, the call decoder and its hash gates,
  vote encoding, and similar logic are expected to ship with tests.
- UI screens are generally not unit-tested; verify those on a device.

Run `npm run test:run` and make sure the suite is green before opening a PR.

## Pull requests

1. Branch from **`beta`** and open your PR against `beta` — that's the integration branch, and it
   auto-deploys to a live beta preview. `main` is the protected production branch: it only receives
   beta→main release PRs with CI green, and rejects direct pushes for everyone, maintainer included.
2. Keep the change focused — one logical change per PR. Vertical slices that ship something usable
   end-to-end are preferred over broad scaffolding.
3. Before pushing, confirm **`npm run typecheck`, `npm run lint`, and `npm run test:run` are all
   green**, and that the production build (`npm run build`) succeeds.
4. Write a clear PR description: what changed, why, and how you verified it (including on-device notes
   where relevant).
5. If your change touches an extrinsic or a chain-decode path, include or reference the spike that
   proves the call/decoding shape against the live chain.

## Reporting bugs and vulnerabilities

- **Regular bugs:** open a GitHub issue with steps to reproduce, device/browser, and what you
  expected versus saw.
- **Security vulnerabilities:** do **not** open a public issue. Follow the responsible-disclosure
  process in [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[Apache-2.0 License](LICENSE) that covers the project.
