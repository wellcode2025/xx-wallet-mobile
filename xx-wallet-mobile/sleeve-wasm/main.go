// Package main is the WebAssembly entry point for xx Wallet's Sleeve integration.
//
// It wraps the audited xxfoundation/sleeve Go reference and exposes two
// functions to JavaScript:
//
//   - newSleeveWallet(passphrase)
//       Generate a brand-new Sleeve wallet using the browser's CSPRNG.
//
//   - recoverSleeveFromMnemonic(quantumMnemonic, passphrase)
//       Re-derive a Sleeve wallet from an existing quantum mnemonic.
//
// Both return the same shape:
//
//   { success: bool,
//     msg:     string,
//     mnemonics: { quantum: string, standard: string }   // present when success=true
//   }
//
// We expose ONLY these two functions and only the dual-mnemonic Sleeve mode.
// The single-seed mode is intentionally not exposed here — see docs/STRATEGY_UPDATE
// and the Sleeve discovery notes for the reasoning (single-seed is still
// experimental and has different xx network address derivation than the
// production dual-seed path that wallet.xx.network and the audited reference use).
//
// Build with:
//   GOOS=js GOARCH=wasm go build -o ../public/sleeve/main.wasm .
// (the build.sh script in this directory does this plus copies wasm_exec.js)
package main

import (
	"crypto/rand"
	"syscall/js"

	"github.com/xx-labs/sleeve/wallet"
)

func main() {
	// Register the API surface on the JS global object so JS can call into Go.
	js.Global().Set("newSleeveWallet", js.FuncOf(newSleeveWallet))
	js.Global().Set("recoverSleeveFromMnemonic", js.FuncOf(recoverSleeveFromMnemonic))

	// Signal to the JS side that the WASM module is fully initialized and the
	// API surface is now callable. This replaces walletgen's setTimeout(50)
	// hack — the JS wrapper sets `window.__sleeveReady` BEFORE running go.run(),
	// then awaits it.
	if cb := js.Global().Get("__sleeveReady"); cb.Type() == js.TypeFunction {
		cb.Invoke()
	}

	// Block forever so the Go runtime stays alive and the registered functions
	// remain callable. Without this, main() returns and the WASM module exits.
	select {}
}

// newSleeveWallet generates a new Sleeve wallet using the system CSPRNG.
// JS signature: newSleeveWallet(passphrase: string) -> object
func newSleeveWallet(_ js.Value, args []js.Value) interface{} {
	passphrase := ""
	if len(args) > 0 && args[0].Type() == js.TypeString {
		passphrase = args[0].String()
	}

	sleeve, err := wallet.NewSleeve(rand.Reader, passphrase, wallet.DefaultGenSpec())
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"msg":     err.Error(),
		}
	}

	return map[string]interface{}{
		"success": true,
		"msg":     "",
		"mnemonics": map[string]interface{}{
			"quantum":  sleeve.GetMnemonic(),
			"standard": sleeve.GetOutputMnemonic(),
		},
	}
}

// recoverSleeveFromMnemonic re-derives a Sleeve wallet from an existing
// 24-word quantum mnemonic. Used when a user is importing or recovering
// a Sleeve account they generated previously (in our wallet, in
// sleeve.xx.network's tool, or anywhere else that uses this same scheme).
//
// JS signature: recoverSleeveFromMnemonic(quantumMnemonic: string, passphrase: string) -> object
func recoverSleeveFromMnemonic(_ js.Value, args []js.Value) interface{} {
	if len(args) < 1 || args[0].Type() != js.TypeString {
		return map[string]interface{}{
			"success": false,
			"msg":     "missing or invalid quantum mnemonic argument",
		}
	}
	quantum := args[0].String()

	passphrase := ""
	if len(args) > 1 && args[1].Type() == js.TypeString {
		passphrase = args[1].String()
	}

	sleeve, err := wallet.NewSleeveFromMnemonic(quantum, passphrase, wallet.DefaultGenSpec())
	if err != nil {
		return map[string]interface{}{
			"success": false,
			"msg":     err.Error(),
		}
	}

	return map[string]interface{}{
		"success": true,
		"msg":     "",
		"mnemonics": map[string]interface{}{
			"quantum":  sleeve.GetMnemonic(),
			"standard": sleeve.GetOutputMnemonic(),
		},
	}
}
