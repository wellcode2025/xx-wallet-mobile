# Security policy

## Status

xx Wallet Mobile is feature-complete across its planned surfaces and verified end-to-end against live xx network: core wallet (accounts, send/receive, transaction history), multisig (proposal / approval / cancellation / cross-wallet bytes-package handoff / chain scan for discoverable multisigs), the full staking lifecycle for both nominators and validators (nominate, manage, unbond/withdraw, validator setup, cMix node-identity maintenance, slash alerts), the full Gov1 governance surface (read and participate across democracy, council, treasury, bounties, and tips), and Ledger hardware accounts (transfers and staking signed on-device; desktop over WebHID, Android over a USB cable). The codebase has **not** yet been independently audited by a third-party security firm; treat it as experimental software and use it at your own risk. This document is intended for security researchers, integrators, and users who want to understand exactly what threats the wallet does and does not protect against.

**If you find a vulnerability, please follow the responsible-disclosure process at the bottom of this document rather than opening a public issue.**

---

## What the wallet protects against

The wallet is designed to defend against a specific set of threats:

- **A passive network adversary.** All chain-state interaction happens over WebSocket Secure (`wss://`) by default. Custom RPC endpoints over plaintext `ws://` are only permitted for `localhost` — the Settings validator rejects remote `ws://` URLs.
- **A compromised RPC endpoint serving wrong data.** Signing happens entirely on the user's device with locally-held keys. The RPC node sees broadcasted transactions but cannot forge signatures or modify them in flight. The worst a malicious endpoint can do is lie about chain state (false balances, withheld history) — not steal funds.
- **A malicious xxfoundation indexer response.** Indexer responses populate the dashboard's transaction history and contact identity data. They are never executed as code; they are rendered as text through React's standard escaping. There is no path from indexer output to script execution.
- **Self-send mistakes.** The wallet refuses to broadcast a transaction whose recipient address equals the active account — Substrate accepts these as fee-only no-ops, which silently drain a fee while producing no visible Transfer event.
- **Existential-deposit reaping.** The wallet uses `transferKeepAlive` so the sender cannot accidentally drop their own balance below the existential deposit, and warns the user when the recipient would receive less than the existential deposit (a new-account creation risk).
- **Brute force against an exfiltrated keystore.** All accounts created by this wallet, and all keystores imported from `wallet.xx.network`, are encrypted with `scrypt` at `N=131072, r=8, p=1` — matching the strength of the official desktop wallet's exports. An exfiltrated keystore is not directly usable; the attacker must first crack the user's password against the strong KDF.
- **Imported phishing contacts.** The contact-import flow validates every imported address against the xx network SS58 format (prefix 55) and rejects entries with invalid addresses. Free-text fields are length-bounded, and total contacts are capped per wallet.
- **Click-jacking and same-origin frame embedding.** Response headers include `X-Frame-Options: DENY` and `frame-ancestors 'none'` in the Content Security Policy.
- **The depositor-as-narrator attack on multisig approvals.** When approving a multisig proposal, the wallet decodes the call from the actual on-chain call bytes (or the bytes the depositor shared, with hash verification against what the chain stores). The decoded description is *always* derived from bytes; it is never trusted from depositor-supplied text. If the recomputed hash doesn't match the chain's stored hash, the wallet refuses to render the proposal and shows a loud error instead. A malicious depositor cannot say "this approves a coffee" while the bytes actually authorize a treasury transfer — the wallet sees the bytes themselves.
- **Tampered multisig config imports.** Every multisig import path (manual entry, JSON config import, chain scan) derives the multisig address locally from the threshold + signer list and refuses to import if the claimed address doesn't match. A config JSON cannot lie about which on-chain multisig it represents.
- **Casual access to an unlocked, unattended device (optional).** The wallet offers an opt-in *app lock* — a PIN, with device biometrics (fingerprint or face) optionally layered on top — that gates opening the app. It is an access gate for privacy on a shared, borrowed, or lost phone. It deliberately does **not** gate signing: the keys stay encrypted with the signing password regardless, and a biometric or PIN unlock authorizes *viewing* the wallet, never *spending* from it. Biometric unlock is offered only on devices with a platform authenticator over a secure (HTTPS) origin, and always keeps the PIN as a fallback. The app lock is off by default.
- **Address-and-IP disclosure to the indexer (optional).** Queries to the public xx network
  indexer reveal the requesting IP and the addresses being asked about. A Settings → Privacy
  toggle disables all indexer traffic; enforcement is a single local gate every indexer query
  flows through, so no code path can leak when it's off. The affected views (history, rewards,
  multisig activity and chain scan, identity enrichment) state plainly what's unavailable and
  why, and identity lookups fall back to direct chain RPC. Funds-related operations never
  depended on the indexer.
- **Keystore exfiltration — eliminated entirely for Ledger accounts.** A Ledger-backed account stores only an address and a derivation path in the wallet; the private key lives on the device's secure element and never enters the browser. There is no keystore to steal, no password to phish, and every transaction is displayed on and physically confirmed at the device — a compromised page can lie on screen but cannot fake the Ledger's display. The wallet requires the address to be confirmed on the device screen before a Ledger account is added, for the same reason. Calls the Ledger xx network app cannot decode and display (multisig, governance democracy calls) are refused in the wallet rather than blind-signed — what the device cannot show you, the wallet will not ask it to sign.

## What the wallet does not protect against

These are explicitly out of scope. Users should understand them before storing significant value in the wallet.

- **A compromised browser or browser extension.** A malicious browser extension with same-origin or `debugger` privileges can read `localStorage`, intercept keystrokes (including the wallet password), modify the running page, or read process memory. There is no software defence against this from inside the browser. Do not install untrusted extensions in the same browser profile you use for the wallet.
- **Physical device access.** If an attacker has physical access to an unlocked device with the wallet installed and the user's password is known or weak, they can sign transactions. The optional app lock (a PIN, optionally with biometrics) raises the bar against a borrowed or briefly-unattended phone, but it is an access gate only — it does not change the fund boundary, which remains the per-account signing password (and, for shared funds, a multisig threshold). Biometric or PIN unlock never authorizes spending by itself. Use device-level lock screens and a strong wallet password; for material balances, prefer a multisig you control across two devices, or a hardware signer.
- **A weak password.** The wallet enforces a minimum length of 8 characters and refuses passwords that appear in a built-in common-password blocklist (covers the well-known top entries from rockyou-style corpora). It does not yet score password strength against a full breach corpus or compute zxcvbn-style estimated crack time. A password that is long enough and not in the blocklist but is still low-entropy (e.g. a single dictionary word) will be cracked offline against any KDF if the keystore is exfiltrated.
- **A compromised build pipeline.** The wallet's static assets are served from Cloudflare. Anyone who controls the Cloudflare account, the GitHub repository, or the DNS for the served domain can replace the wallet's code at any time; users will receive the replaced code through the service worker's update mechanism — applied when the user taps *Update* in the in-app banner, with no signature or version-pin check to catch the substitution. This is the fundamental trust model of any browser-based wallet — see the *Deployment trust model* section below.
- **A compromised xxfoundation indexer.** The indexer is treated as a trusted source for transaction history and identity metadata. A malicious indexer cannot forge signatures or modify funds, but it can show false transaction history, hide transactions, and learn the IP address and queried addresses of every user. Users who consider that unacceptable can disable indexer queries entirely in Settings → Privacy (see above) at the cost of the historical views.
- **Quantum attacks against current-generation curve cryptography.** The wallet's daily-use sr25519 keypair is, like every Substrate wallet, vulnerable to a sufficiently capable quantum computer. The wallet *does* generate a Sleeve quantum-resistant master phrase alongside the standard mnemonic at creation time, which is intended to be used in the future to roll over to a quantum-secure identity once xx network adopts it on chain. The Sleeve master phrase is **never stored anywhere in the wallet** — the user's external backup is the only copy.
- **The user not backing up their phrases.** The wallet shows both the Sleeve quantum mnemonic and the standard mnemonic exactly once during onboarding, and never again. If the user does not back them up and later loses access to their device, the funds are unrecoverable. This is a feature of self-custody, not a wallet bug.
- **Clipboard exposure of copied phrases.** The recovery-phrase screen offers a copy-to-clipboard convenience. The system clipboard can be read by clipboard-history managers, other local apps, and cross-device ("cloud") clipboard sync, any of which may persist the value beyond the session. The wallet shows a caution when a phrase is copied and makes a best-effort attempt to clear the clipboard shortly afterwards — only while the phrase is still the clipboard contents, and only on secure-context browsers that permit clipboard reads — but neither is guaranteed. Prefer transcribing phrases by hand; if you copy, paste and then clear your clipboard, and avoid clipboard-sync tools for secrets.

## Cryptographic primitives

| Purpose | Algorithm | Source |
| --- | --- | --- |
| Mnemonic generation | BIP-39 (24 words, 256 bits entropy) | `@polkadot/util-crypto` |
| Sleeve quantum-secure key | WOTS+ (hash-based one-time signature) | [`xxfoundation/sleeve`](https://github.com/xxfoundation/sleeve), audited 2021 by Jean-Philippe Aumasson |
| Daily-use signing | sr25519 | `@polkadot/util-crypto` |
| Address format | SS58 prefix 55 (xx network) | `@polkadot/keyring` |
| Keystore key derivation | scrypt N=131072, r=8, p=1 | `scrypt-js` (matching `wallet.xx.network` strength) |
| Keystore encryption | xsalsa20-poly1305 | `tweetnacl` |
| Hash primitives in Sleeve | SHA3-256, BLAKE2b | upstream xxfoundation/sleeve via WASM |
| Random number source for entropy | `crypto.getRandomValues` (browser CSPRNG) | host browser; via Go's `crypto/rand` for Sleeve |

## Keystore hardening

These are specific properties the keystore implementation upholds. The keyring source references them by these identifiers (H-1 / H-2 / H-3).

- **H-1 — strong key derivation.** Account keystores are encrypted with a key derived via scrypt at N=131072, r=8, p=1 — matching `wallet.xx.network` rather than `@polkadot/util-crypto`'s weaker default of N=32768. A keystore exported from this wallet therefore has the same brute-force resistance as one exported from the official wallet.
- **H-2 — minimal plaintext-key lifetime.** Intermediate decrypted PKCS8 buffers are zeroed in `finally` blocks, and the in-memory keypair is locked (`pair.lock()`) immediately after each signing operation, so plaintext secret material is not kept in memory longer than necessary. JavaScript cannot guarantee a true memory wipe (the engine may relocate buffers or retain register copies), so this is best-effort defence-in-depth, not a guarantee.
- **H-3 — keystore format pinning.** Only v3 `scrypt` + `xsalsa20-poly1305` keystores are accepted on import; other versions or cipher suites are rejected explicitly rather than parsed at the wrong byte offsets, so an unexpected or malformed file fails closed.

## Deployment trust model

The wallet is a static SPA hosted on Cloudflare Workers Static Assets, with auto-deploy from this GitHub repository. The chain of trust is:

1. The GitHub repository — anyone with `push` access to `main` can introduce new code that will deploy automatically.
2. The Cloudflare account hosting the Worker — controlled by the **xx Foundation** (the same infrastructure that serves other xx network properties), not by an individual contributor. Anyone with deploy access to it can replace the live wallet.
3. The DNS — `mobile.xx.network` is a subdomain of the Foundation-controlled `xx.network` zone; anyone who can change its records can redirect users to a different origin.
4. The user's installed Progressive Web App — the service worker is registered with `registerType: 'prompt'`, so a new version is fetched in the background but **not applied silently**: it activates only when the user taps *Update now* in the in-app update banner. That prompt is a UX / state-preservation safeguard, not a security control — there is still no version pin and no signature check on the served bundle, so tapping *Update* against a compromised deployment runs the replaced code.

In other words, the hosting and DNS trust surface is the xx Foundation's own infrastructure — the same place the official `wallet.xx.network` is served from — rather than a third-party or personal server. This is the same trust model used by every browser-served wallet (`wallet.xx.network` included). Users who require stronger guarantees should use a hardware wallet for material balances and treat any browser-served wallet — including this one — as a hot wallet for active operating funds only.

## Reporting a vulnerability

If you believe you have found a security issue, please **do not open a public GitHub issue**.

Use one of:

1. **GitHub Private Vulnerability Reporting** — preferred. Go to the [Security tab](../../security) of this repository and click *Report a vulnerability*. This creates a private, audit-logged thread between you and the maintainer.
2. **Email** — send a detailed report to the address listed on the maintainer's GitHub profile, with the subject prefix `[xx-wallet-mobile security]`.

Please include:

- A description of the issue and its security impact.
- Reproduction steps, ideally against a test account on testnet rather than mainnet.
- The commit SHA or release version your report applies to.
- Any proof-of-concept code or sample data.
- Whether you are willing to be credited publicly when a fix is released.

You can expect:

- An acknowledgement within 7 days.
- A best-effort estimate of remediation timeline within 7 days of acknowledgement.
- Public disclosure once a fix has been deployed, with credit to the reporter unless you request anonymity.

We are a small project and do not currently run a paid bug-bounty program. Recognition is via release notes and a CREDITS file. If you have suggestions for what the wallet should do better, technical or otherwise, we welcome those too.
