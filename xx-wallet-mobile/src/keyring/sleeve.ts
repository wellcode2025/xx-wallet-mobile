/**
 * Sleeve WASM wrapper.
 *
 * Loads the audited xxfoundation/sleeve Go reference (compiled to WebAssembly
 * by sleeve-wasm/build.sh) on demand, and exposes a clean async TypeScript API
 * for generating + recovering Sleeve wallets.
 *
 * Loading is lazy and one-shot — the WASM module isn't fetched until the first
 * call, and is reused for every subsequent call. This keeps the wallet's
 * initial bundle small for users who only ever import existing accounts (they
 * never trigger this path).
 *
 * For the strategic context on why dual-mnemonic Sleeve and not the
 * experimental single-seed variant, see docs/.
 */

const DEFAULT_WASM_EXEC_URL = '/sleeve/wasm_exec.js';
const DEFAULT_WASM_URL = '/sleeve/main.wasm';

/**
 * The shape returned from Go for both newSleeveWallet and
 * recoverSleeveFromMnemonic. See sleeve-wasm/main.go for the producing side.
 */
interface SleeveResult {
  success: boolean;
  msg: string;
  mnemonics?: {
    quantum: string;
    standard: string;
  };
}

/**
 * The two functions the Go runtime registers on the JS global once initialized.
 */
interface SleeveModule {
  newSleeveWallet: (passphrase: string) => SleeveResult;
  recoverSleeveFromMnemonic: (quantumMnemonic: string, passphrase: string) => SleeveResult;
}

export interface SleeveInitOptions {
  /** URL to fetch the Go runtime helper script from. Defaults to '/sleeve/wasm_exec.js'. */
  wasmExecUrl?: string;
  /**
   * URL of the WASM binary, OR pre-fetched bytes (useful in tests where there
   * is no fetch server). Defaults to fetching '/sleeve/main.wasm'.
   */
  wasmSource?: string | ArrayBuffer | Uint8Array;
  /**
   * If true, skip loading wasm_exec.js — caller has already arranged for
   * `globalThis.Go` to be defined. Useful for Node-side tests that load
   * wasm_exec.js by other means.
   */
  skipWasmExecLoad?: boolean;
}

export interface SleeveMnemonics {
  /** The 24-word quantum mnemonic. The user must back this up — losing it
   *  forfeits the future ability to roll over to the WOTS+ quantum-secure
   *  identity when the chain enables that. We never store it in the wallet. */
  quantumMnemonic: string;
  /** The 24-word standard mnemonic. Used to derive the active sr25519
   *  keypair. Equivalent to a normal BIP39 mnemonic for everyday wallet ops. */
  standardMnemonic: string;
}

let initPromise: Promise<SleeveModule> | null = null;

/**
 * Initialize the Sleeve WASM module. Idempotent — repeated calls return the
 * same promise. Most callers don't need to call this directly: the
 * generate/recover functions auto-init on first use.
 */
export function initSleeve(opts: SleeveInitOptions = {}): Promise<SleeveModule> {
  if (!initPromise) {
    initPromise = doInit(opts).catch((err) => {
      // Reset so a subsequent call retries cleanly rather than returning
      // the cached failure forever.
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function doInit(opts: SleeveInitOptions): Promise<SleeveModule> {
  const wasmExecUrl = opts.wasmExecUrl ?? DEFAULT_WASM_EXEC_URL;
  const wasmSource = opts.wasmSource ?? DEFAULT_WASM_URL;

  // 1. Make sure the Go runtime helper is loaded. It defines `globalThis.Go`,
  //    a constructor that bridges between the WASM module and JS.
  if (!opts.skipWasmExecLoad) {
    await loadScriptOnce(wasmExecUrl);
  }
  const GoCtor = (globalThis as unknown as { Go?: new () => GoRuntime }).Go;
  if (typeof GoCtor !== 'function') {
    throw new Error(
      'Sleeve WASM init: globalThis.Go is undefined. ' +
        'Ensure wasm_exec.js loaded before init, or pass skipWasmExecLoad: false.'
    );
  }

  // 2. Get the WASM bytes — fetch a URL or use whatever the caller provided.
  const wasmBytes = await resolveWasmBytes(wasmSource);

  // 3. Instantiate the module against the Go runtime's import object.
  const go = new GoCtor();
  const wasmModule = await WebAssembly.instantiate(wasmBytes, go.importObject);

  // 4. Set up the readiness callback BEFORE running the Go program. The Go
  //    side calls __sleeveReady() at the end of main(), right before blocking
  //    on `select{}`. This replaces the setTimeout(50) hack from the
  //    reference walletgen example with a proper signal.
  const ready = new Promise<void>((resolve) => {
    (globalThis as unknown as { __sleeveReady?: () => void }).__sleeveReady = () => {
      // Clean up so we don't leak across a second init (which shouldn't
      // happen given the initPromise cache, but defense-in-depth).
      delete (globalThis as unknown as { __sleeveReady?: () => void }).__sleeveReady;
      resolve();
    };
  });

  // 5. Kick off the Go program. main() will:
  //    - register newSleeveWallet + recoverSleeveFromMnemonic on globalThis
  //    - invoke __sleeveReady (resolves our promise)
  //    - block on select{} forever (keeps the runtime + registered fns alive)
  go.run(wasmModule.instance);

  // 6. Wait for the ready signal before declaring init complete.
  await ready;

  // 7. Pluck the registered functions off the global and verify they exist.
  type GlobalWithSleeve = {
    newSleeveWallet?: SleeveModule['newSleeveWallet'];
    recoverSleeveFromMnemonic?: SleeveModule['recoverSleeveFromMnemonic'];
  };
  const g = globalThis as unknown as GlobalWithSleeve;
  if (typeof g.newSleeveWallet !== 'function' || typeof g.recoverSleeveFromMnemonic !== 'function') {
    throw new Error(
      'Sleeve WASM init: expected functions are missing from the global ' +
        'after initialization. The WASM may have failed to register them.'
    );
  }
  return {
    newSleeveWallet: g.newSleeveWallet,
    recoverSleeveFromMnemonic: g.recoverSleeveFromMnemonic,
  };
}

async function resolveWasmBytes(
  source: string | ArrayBuffer | Uint8Array
): Promise<ArrayBuffer> {
  if (typeof source === 'string') {
    const resp = await fetch(source);
    if (!resp.ok) {
      throw new Error(`Sleeve WASM init: failed to fetch ${source} (${resp.status})`);
    }
    return resp.arrayBuffer();
  }
  if (source instanceof Uint8Array) {
    // Slice into a fresh ArrayBuffer to detach from any pooled storage.
    return source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength
    ) as ArrayBuffer;
  }
  return source;
}

const loadedScripts = new Set<string>();
async function loadScriptOnce(src: string): Promise<void> {
  if (loadedScripts.has(src)) return;
  if (typeof document === 'undefined') {
    throw new Error(
      `Sleeve WASM init: loadScriptOnce called in non-DOM environment for ${src}. ` +
        'Pass skipWasmExecLoad: true and arrange for globalThis.Go yourself.'
    );
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`Sleeve WASM init: failed to load script ${src}`));
    document.head.appendChild(script);
  });
  loadedScripts.add(src);
}

/**
 * Generate a fresh Sleeve wallet using the browser's CSPRNG (via Go's
 * crypto/rand inside the WASM). Returns both mnemonics for the user to
 * back up; neither is stored.
 *
 * The standard mnemonic should be passed to `xxKeyring.createFromMnemonic`
 * to derive the actual sr25519 account that operates on xx network today.
 * The quantum mnemonic must be backed up separately by the user — it is
 * the master that can re-derive the standard mnemonic, and is the key to
 * the eventual quantum-secure identity rollover.
 */
export async function generateSleeveAccount(
  passphrase = '',
  initOpts?: SleeveInitOptions
): Promise<SleeveMnemonics> {
  const mod = await initSleeve(initOpts);
  const result = mod.newSleeveWallet(passphrase);
  if (!result.success || !result.mnemonics) {
    throw new Error(`Sleeve generation failed: ${result.msg}`);
  }
  return {
    quantumMnemonic: result.mnemonics.quantum,
    standardMnemonic: result.mnemonics.standard,
  };
}

/**
 * Re-derive a Sleeve wallet from an existing 24-word quantum mnemonic.
 * Used in the import / recovery path when a user already has a Sleeve
 * mnemonic from a previous session, sleeve.xx.network, or another wallet
 * that uses the same scheme.
 */
export async function recoverSleeveFromQuantumMnemonic(
  quantumMnemonic: string,
  passphrase = '',
  initOpts?: SleeveInitOptions
): Promise<SleeveMnemonics> {
  const mod = await initSleeve(initOpts);
  const result = mod.recoverSleeveFromMnemonic(quantumMnemonic, passphrase);
  if (!result.success || !result.mnemonics) {
    throw new Error(`Sleeve recovery failed: ${result.msg}`);
  }
  return {
    quantumMnemonic: result.mnemonics.quantum,
    standardMnemonic: result.mnemonics.standard,
  };
}

/**
 * Minimal type for the Go runtime constructor that wasm_exec.js exports.
 * We don't use most of its surface; just enough for typing.
 */
interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}
