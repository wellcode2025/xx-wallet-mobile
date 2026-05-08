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

import { SLEEVE_WASM_SHA256 } from './sleeveWasmHash';

const DEFAULT_WASM_EXEC_URL = '/sleeve/wasm_exec.js';
const DEFAULT_WASM_URL = '/sleeve/main.wasm';

// Special placeholder value the auto-generated hash file ships with
// before `npm run prebuild` populates the real value. If we see this at
// runtime, it means the build was misconfigured and the integrity check
// would always fail — better to surface that loudly with a clear message
// than throw "hash mismatch" generically.
const HASH_PLACEHOLDER = 'PLACEHOLDER_RUN_HASH_SCRIPT_TO_POPULATE';

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
  /**
   * If true, skip the SHA-256 integrity check on the loaded WASM. Test-only
   * escape hatch — should never be set in production code paths. Tests that
   * stub the WASM with synthetic bytes will need this; the real wallet
   * never does.
   */
  skipIntegrityCheck?: boolean;
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

  // 3. Verify integrity before instantiation. The expected SHA-256 is baked
  //    into the bundle by the `prebuild` npm script, computed from the
  //    .wasm file present in the repo at build time. A mismatch means the
  //    deployed module differs from what shipped — fail closed.
  //
  //    Caveat: `crypto.subtle` (the SubtleCrypto API we use to hash the
  //    fetched bytes) is only available in *secure contexts* — HTTPS,
  //    localhost, or file://. On a plain-HTTP LAN dev server (e.g.
  //    http://10.0.0.x:5173 from a phone), it's undefined. We skip the
  //    check there with a warning rather than blocking dev. Production
  //    (HTTPS) always has it, so the check always runs in deployed
  //    builds — which is the only deployment surface we actually need
  //    to defend.
  if (!opts.skipIntegrityCheck) {
    if (SLEEVE_WASM_SHA256 === HASH_PLACEHOLDER) {
      throw new Error(
        'Sleeve WASM init: build is misconfigured — sleeveWasmHash.ts still ' +
          'contains the placeholder value. Run `npm run hash-wasm` (or ' +
          '`npm run build`, which auto-runs the prebuild step) and rebuild.'
      );
    }
    const actualHash = await sha256Hex(wasmBytes);
    if (actualHash === null) {
      // Non-secure context. Log loudly so a misconfigured production
      // deploy (somehow served over HTTP) is also visible, even if we
      // don't fail closed.
      console.warn(
        'Sleeve WASM integrity check skipped: crypto.subtle is unavailable ' +
          'in this context. This is expected on plain-HTTP dev servers ' +
          '(http://10.0.0.x:port). Production (HTTPS) always has crypto.subtle ' +
          'and the check runs there.'
      );
    } else if (actualHash !== SLEEVE_WASM_SHA256) {
      throw new Error(
        `Sleeve WASM integrity check failed: expected SHA-256 ${SLEEVE_WASM_SHA256}, ` +
          `got ${actualHash}. Refusing to load a module that doesn't match the ` +
          `build's pinned hash. If this is unexpected, check for service-worker ` +
          `cache poisoning or a deployment compromise.`
      );
    }
  }

  // 4. Instantiate the module against the Go runtime's import object.
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

/**
 * Hash bytes with SHA-256, returning lowercase hex.
 *
 * Returns `null` (rather than throwing) if `crypto.subtle` is unavailable
 * — that happens in non-secure contexts (plain HTTP from non-localhost),
 * which is essentially "the dev server reached from a phone over the LAN".
 * The caller decides whether to skip the integrity check or fail.
 */
async function sha256Hex(bytes: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return null;
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
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

/**
 * Defence in depth: only allow same-origin /sleeve/* URLs through the
 * loader. The only legitimate caller is our own code passing the hardcoded
 * '/sleeve/wasm_exec.js' default, but enforcing the constraint here means
 * a future refactor or accidental misuse can't turn this into a script-
 * injection sink.
 */
function isSafeSleeveScriptUrl(src: string): boolean {
  if (typeof window === 'undefined') return false;
  // Bare absolute path — most common case.
  if (src.startsWith('/sleeve/')) return true;
  // Full URL — must resolve to same origin and a /sleeve/ path.
  try {
    const resolved = new URL(src, window.location.origin);
    return (
      resolved.origin === window.location.origin &&
      resolved.pathname.startsWith('/sleeve/')
    );
  } catch {
    return false;
  }
}

async function loadScriptOnce(src: string): Promise<void> {
  if (loadedScripts.has(src)) return;
  if (typeof document === 'undefined') {
    throw new Error(
      `Sleeve WASM init: loadScriptOnce called in non-DOM environment for ${src}. ` +
        'Pass skipWasmExecLoad: true and arrange for globalThis.Go yourself.'
    );
  }
  if (!isSafeSleeveScriptUrl(src)) {
    throw new Error(
      `Sleeve WASM init: refusing to load script from untrusted URL: ${src}`
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
