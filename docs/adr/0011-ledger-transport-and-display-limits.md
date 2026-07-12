# ADR-0011: Ledger — WebHID/WebUSB only (no Bluetooth, no iOS); refuse what the device can't display

- Status: accepted (retroactive capture, decisions made 2026-06-12)
- Date: 2026-07-11
- Tier: T2
- Review: independent (verified on mainnet on both form factors)

## Context

Hardware signing's entire value is that the device display is the last honest narrator — a compromised page can lie on screen but not on the Ledger. That value collapses anywhere the wallet asks the device to sign what it cannot show (blind signing), and reliability collapses on transports that don't actually work in browsers.

## Decision

Transports are **WebHID (desktop Chromium) and WebUSB (Android Chrome over USB-C) only**. Bluetooth was deliberately removed: web-BLE bonding is broken upstream (LedgerHQ/ledgerjs#352) — do not re-add without a proven upstream fix. iOS is unsupported because no browser APIs exist. `usb=(self), hid=(self)` in `public/_headers` is load-bearing for both transports. Adding a Ledger account **requires on-device address confirmation**. Within Ledger xx app 1.203.2 limits: batched calls split into sequential per-call device approvals (`useSequentialTx`; only `sequenceDone` signals completion), and calls the app cannot decode — multisig cosigning, democracy calls — are **refused with a visible explanation** rather than blind-signed. Every connect error message tells the user to open the xx network app on the device (the step users reliably miss).

## Alternatives considered

- **Blind-sign unsupported calls with a warning:** rejected — negates the hardware trust model precisely where stakes are highest.
- **Keep BLE with caveats:** rejected — a signing transport that intermittently fails at the bonding layer is worse than absent.
- **Generic Substrate Ledger app:** rejected — the Zondax xx app matches the chain's custom calls (e.g., `bond(controller, value, cmixId)`).

## Consequences

Coverage is honest: desktop + Android, transfers + staking; the unsupported list is visible in-product. `_headers` joins the T2 file list — any new device-API feature must check the Permissions-Policy allowlist. Ledger app updates require re-probing (`scratch/ledger-spike.html`) before assuming new call support.

## Reversibility

Transport set and refusal policy are easily extended when upstream reality changes (BLE fix, richer app decode tables); each extension is T2 with on-device verification.
