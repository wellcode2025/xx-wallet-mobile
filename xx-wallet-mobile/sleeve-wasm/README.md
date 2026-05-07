# sleeve-wasm

Compiles the audited [xxfoundation/sleeve](https://github.com/xxfoundation/sleeve) Go reference to WebAssembly so the wallet can do Sleeve key generation in the browser without porting WOTS+ to JavaScript.

The pattern follows [`xxfoundation/scripts/walletgen`](https://github.com/xxfoundation/scripts) — same approach xxfoundation themselves use.

## What this exposes

The compiled WASM registers two functions on the JS global:

- `newSleeveWallet(passphrase)` — generate a fresh Sleeve wallet
- `recoverSleeveFromMnemonic(quantumMnemonic, passphrase)` — re-derive from an existing quantum mnemonic

Both return `{ success, msg, mnemonics: { quantum, standard } }`. See `main.go` for details.

## Building

```bash
./build.sh
```

This:

1. Runs `go mod tidy` to fetch `xx-labs/sleeve` (first run only — cached after).
2. Finds Go's `wasm_exec.js` runtime helper.
3. Compiles `main.go` to `../public/sleeve/main.wasm`.
4. Copies `wasm_exec.js` to `../public/sleeve/wasm_exec.js`.

The two artifacts in `public/sleeve/` are committed to the repo so day-to-day `npm install` / `npm run build` work without Go installed. Only when this Go source changes do we rebuild.

## When to rebuild

- The Go source in `main.go` changes.
- The pinned version of `xx-labs/sleeve` is bumped.
- Go itself is upgraded and we want to pick up runtime improvements.

For everything else, leave the prebuilt artifacts alone.

## Why dual-mnemonic only

We intentionally only expose the dual-mnemonic Sleeve mode. The single-seed variant in `Tranquil-Flow/sleeve-modification-single-seed` (the bounty work) is still in development and uses different xx network address derivation than the production audited path. See `docs/` for the full reasoning. When xxfoundation finalizes single-seed and ships official xx network support for it, we'll expose it as a second mode here alongside dual-mnemonic.
