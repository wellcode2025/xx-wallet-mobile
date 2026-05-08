# Security policy

## Status

xx Wallet Mobile is currently in **Phase 1** — core wallet features are complete and verified end-to-end against live xx network, but the codebase has not yet been independently audited by a third-party security firm. This document is intended for security researchers, integrators, and users who want to understand exactly what threats the wallet does and does not protect against.

If you find a vulnerability, please follow the responsible-disclosure process at the bottom of this document rather than opening a public issue.

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

## What the wallet does not protect against

These are explicitly out of scope. Users should understand them before storing significant value in the wallet.

- **A compromised browser or browser extension.** A malicious browser extension with same-origin or `debugger` privileges can read `localStorage`, intercept keystrokes (including the wallet password), modify the running page, or read process memory. There is no software defence against this from inside the browser. Do not install untrusted extensions in the same browser profile you use for the wallet.
- **Physical device access.** If an attacker has physical access to an unlocked device with the wallet installed and the user's password is known or weak, they can sign transactions. Use device-level lock screens and a strong wallet password.
- **A weak password.** The wallet enforces a minimum length of 8 characters but does not yet score password strength against common-password lists or breach corpora. A truly weak password (e.g. `12345678`, `password`) will be cracked offline in seconds against any KDF if the keystore is exfiltrated.
- **A compromised build pipeline.** The wallet's static assets are served from Cloudflare. Anyone who controls the Cloudflare account, the GitHub repository, or the DNS for the served domain can replace the wallet's code at any time; users will receive the new version through the service worker's auto-update mechanism without prompt. This is the fundamental trust model of any browser-based wallet — see the *Deployment trust model* section below.
- **A compromised xxfoundation indexer.** The indexer is treated as a trusted source for transaction history and identity metadata. A malicious indexer cannot forge signatures or modify funds, but it can show false transaction history, hide transactions, and learn the IP address and queried addresses of every user.
- **Quantum attacks against current-generation curve cryptography.** The wallet's daily-use sr25519 keypair is, like every Substrate wallet, vulnerable to a sufficiently capable quantum computer. The wallet *does* generate a Sleeve quantum-resistant master phrase alongside the standard mnemonic at creation time, which is intended to be used in the future to roll over to a quantum-secure identity once xx network adopts it on chain. The Sleeve master phrase is **never stored anywhere in the wallet** — the user's external backup is the only copy.
- **The user not backing up their phrases.** The wallet shows both the Sleeve quantum mnemonic and the standard mnemonic exactly once during onboarding, and never again. If the user does not back them up and later loses access to their device, the funds are unrecoverable. This is a feature of self-custody, not a wallet bug.

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

## Deployment trust model

The wallet is a static SPA hosted on Cloudflare Workers Static Assets, with auto-deploy from this GitHub repository. The chain of trust is:

1. The GitHub repository — anyone with `push` access to `main` can introduce new code that will deploy automatically.
2. The Cloudflare account hosting the Worker — anyone with deploy access can replace the live wallet.
3. The DNS provider — anyone who can change the domain's CNAME record can redirect users to a different origin.
4. The user's installed Progressive Web App — once installed, the service worker silently fetches and applies new versions on every navigation. There is no version pin, no signature check, no prompt.

This is the same trust model used by every browser-served wallet (`wallet.xx.network` included). Users who require stronger guarantees should use a hardware wallet for material balances and treat any browser-served wallet — including this one — as a hot wallet for active operating funds only.

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

- An acknowledgement within 72 hours.
- A best-effort estimate of remediation timeline within 7 days of acknowledgement.
- Public disclosure once a fix has been deployed, with credit to the reporter unless you request anonymity.

We are a small project and do not currently run a paid bug-bounty program. Recognition is via release notes and a CREDITS file. If you have suggestions for what the wallet should do better, technical or otherwise, we welcome those too.
