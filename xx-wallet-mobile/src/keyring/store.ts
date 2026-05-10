/**
 * xx network keyring.
 *
 * Manages user accounts (keypairs) with encrypted storage in localStorage.
 * Private keys are NEVER stored unencrypted — they are decrypted only when
 * needed to sign a transaction, and re-encrypted immediately after.
 *
 * This is a Phase 1 implementation using standard sr25519 accounts. Full
 * Sleeve (dual-phrase, quantum-secure) support will be added in a later phase.
 *
 * IMPORTANT: The encryption here relies on the user's password + browser's
 * localStorage. This is acceptable for Phase 1 but on a real device we should
 * consider moving to the WebCrypto API with a proper key derivation function
 * and potentially the device's secure storage (e.g., via Credential Management
 * API where available).
 *
 * SCRYPT COMPATIBILITY NOTE:
 * The official wallet.xx.network exports v3 keystore JSON with scrypt N=131072
 * (stronger than Polkadot's hardcoded default of N=32768). The @polkadot/keyring
 * library refuses to decrypt any scrypt JSON that doesn't match its exact default
 * params, throwing "Invalid injected scrypt params found". To interoperate with
 * the official wallet, we implement a manual decryption path using scrypt-js +
 * tweetnacl that honours whatever scrypt params are embedded in the JSON.
 */

import { Keyring } from '@polkadot/keyring';
import type { KeyringPair, KeyringPair$Json } from '@polkadot/keyring/types';
import {
  mnemonicGenerate,
  mnemonicValidate,
  cryptoWaitReady,
  base64Decode,
  base64Encode,
} from '@polkadot/util-crypto';
import { stringToU8a } from '@polkadot/util';
import { scrypt as scryptAsync } from 'scrypt-js';
import nacl from 'tweetnacl';
import { XX_SS58_PREFIX } from '../api/constants';

const STORAGE_KEY = 'xx-wallet:accounts';

// Byte layout of the encoded field when scrypt is used (v3 format):
//   [0..32]   scrypt salt (32 bytes)
//   [32..36]  N  (uint32 little-endian)
//   [36..40]  p  (uint32 little-endian)
//   [40..44]  r  (uint32 little-endian)
//   [44..68]  nacl secretbox nonce (24 bytes)
//   [68..]    nacl secretbox ciphertext
const SCRYPT_SALT_LEN = 32;
const SCRYPT_HEADER_LEN = 44; // salt + N + p + r
const NACL_NONCE_LEN = 24;
const NACL_ENCRYPTED_HEADER_LEN = SCRYPT_HEADER_LEN + NACL_NONCE_LEN; // 68

// Strong scrypt params used when this wallet creates a new account.
// Matches what wallet.xx.network exports (and exceeds @polkadot/keyring's
// default of N=32768) so a JSON exported from this wallet has the same
// brute-force resistance as one exported from the official desktop wallet.
const STRONG_SCRYPT_N = 131072;
const STRONG_SCRYPT_R = 8;
const STRONG_SCRYPT_P = 1;

// PKCS8 wrapper markers that surround the secret key in the decrypted payload.
// These come from @polkadot/keyring/pair/defaults.
const PKCS8_HEADER = new Uint8Array([
  48, 83, 2, 1, 1, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32,
]);
const PKCS8_DIVIDER = new Uint8Array([161, 35, 3, 33, 0]);

export interface StoredAccount {
  /** SS58-encoded address (format 55 — starts with "6"). */
  address: string;
  /** User-provided display name. */
  name: string;
  /** Polkadot JSON keystore — encrypted with the user's password. */
  json: KeyringPair$Json;
  /** When the account was created or imported. */
  createdAt: number;
}

/** Options for creating a new account. */
export interface CreateAccountOptions {
  name: string;
  password: string;
  /** 12 or 24. 24 is recommended by xx network. */
  wordCount?: 12 | 24;
}

/** Options for importing from a mnemonic. */
export interface ImportFromMnemonicOptions {
  name: string;
  mnemonic: string;
  password: string;
}

/** Options for importing from a JSON keystore. */
export interface ImportFromJsonOptions {
  name?: string;
  json: KeyringPair$Json;
  /** Password to validate the JSON can be decrypted. */
  password: string;
}

/**
 * Manually decrypt a Polkadot v3 JSON keystore using whatever scrypt params
 * are embedded in the file. Bypasses the @polkadot/util-crypto hardcoded-params
 * assertion so we can load JSON exported by wallet.xx.network (which uses
 * N=131072 instead of the library default of N=32768).
 *
 * Returns the raw decrypted PKCS8 payload on success, throws on wrong password.
 *
 * Exported for unit testing — callers in this file use it via the public
 * `importFromJson` and `unlock` methods on the keyring class.
 */
export async function manualScryptDecrypt(
  json: KeyringPair$Json,
  password: string
): Promise<Uint8Array> {
  // Pin the keystore format version + cipher suite. We only know the byte
  // layout for v3 scrypt + xsalsa20-poly1305 keystores. A v2 (or future v4)
  // would have a different layout, and feeding it through this function
  // would silently slice bytes from the wrong offsets — bounds checks
  // would either reject (good) or worse, pass and then fail at the
  // secretbox open step. Either way, fail explicitly here instead.
  const enc = json.encoding;
  if (!enc || enc.version !== '3') {
    throw new Error(
      `Unsupported keystore version (expected 3, got ${enc?.version ?? 'unknown'}).`
    );
  }
  if (
    !Array.isArray(enc.type) ||
    !enc.type.includes('scrypt') ||
    !enc.type.includes('xsalsa20-poly1305')
  ) {
    throw new Error(
      'Keystore is not encrypted with the expected scrypt + xsalsa20-poly1305 suite.'
    );
  }

  const encoded = base64Decode(json.encoded);

  // Parse scrypt params from the header
  const salt = encoded.slice(0, SCRYPT_SALT_LEN);
  const view = new DataView(encoded.buffer, encoded.byteOffset);
  const N = view.getUint32(SCRYPT_SALT_LEN, true);
  const p = view.getUint32(SCRYPT_SALT_LEN + 4, true);
  const r = view.getUint32(SCRYPT_SALT_LEN + 8, true);

  // Basic sanity bounds — stops a malicious file from pegging the CPU.
  // Ceiling is generous: N=1048576 covers any reasonable wallet export.
  if (N < 1024 || N > 1048576 || p < 1 || p > 8 || r < 1 || r > 16) {
    throw new Error('Keystore has out-of-range scrypt params.');
  }
  if ((N & (N - 1)) !== 0) {
    throw new Error('Keystore scrypt N is not a power of two.');
  }

  // Derive the 64-byte key using scrypt (pure-JS implementation, no WASM)
  const passwordBytes = stringToU8a(password);
  const derivedKey = await scryptAsync(passwordBytes, salt, N, r, p, 64);
  // Polkadot only uses the first 32 bytes as the secretbox key
  const secretBoxKey = derivedKey.slice(0, 32);

  // The rest of the encoded blob is nacl.secretbox(nonce || ciphertext)
  const nonce = encoded.slice(SCRYPT_HEADER_LEN, SCRYPT_HEADER_LEN + NACL_NONCE_LEN);
  const ciphertext = encoded.slice(NACL_ENCRYPTED_HEADER_LEN);

  const decrypted = nacl.secretbox.open(ciphertext, nonce, secretBoxKey);
  if (!decrypted) {
    throw new Error('Incorrect password for this keystore.');
  }
  return decrypted;
}

/**
 * Encrypt a PKCS8-wrapped sr25519 keypair into a Polkadot v3 JSON keystore
 * using the strong xx-network-style scrypt parameters (N=131072, r=8, p=1).
 *
 * This is the inverse of `manualScryptDecrypt` and is what we use when
 * creating a new account in this wallet — instead of `pair.toJson(password)`
 * which uses @polkadot/util-crypto's weaker default of N=32768.
 *
 * The point: a JSON exported from this wallet should have the same
 * brute-force resistance as one exported from `wallet.xx.network`. See
 * SECURITY.md (H-1) for the threat-model rationale.
 *
 * `templateJson` provides `address` and `meta` — fields that aren't part
 * of the encryption but are part of the standard keystore JSON shape.
 *
 * Exported for unit testing.
 */
export async function manualScryptEncrypt(
  pkcs8: Uint8Array,
  password: string,
  templateJson: Pick<KeyringPair$Json, 'address' | 'meta'>,
  params: { N: number; r: number; p: number } = {
    N: STRONG_SCRYPT_N,
    r: STRONG_SCRYPT_R,
    p: STRONG_SCRYPT_P,
  }
): Promise<KeyringPair$Json> {
  // Fresh salt + nonce per encryption — never reuse them. tweetnacl's
  // randomBytes uses crypto.getRandomValues under the hood in browsers.
  const salt = nacl.randomBytes(SCRYPT_SALT_LEN);
  const nonce = nacl.randomBytes(NACL_NONCE_LEN);

  // Same key derivation as the decrypt path: 64 bytes from scrypt, first
  // 32 used as the secretbox key.
  const passwordBytes = stringToU8a(password);
  const derivedKey = await scryptAsync(
    passwordBytes,
    salt,
    params.N,
    params.r,
    params.p,
    64
  );
  const secretBoxKey = derivedKey.slice(0, 32);

  // Encrypt the PKCS8 payload with xsalsa20-poly1305.
  const ciphertext = nacl.secretbox(pkcs8, nonce, secretBoxKey);

  // Pack the v3 layout: salt(32) | N(4 LE) | p(4 LE) | r(4 LE) | nonce(24) | ciphertext.
  const encoded = new Uint8Array(NACL_ENCRYPTED_HEADER_LEN + ciphertext.length);
  encoded.set(salt, 0);
  const view = new DataView(encoded.buffer);
  view.setUint32(SCRYPT_SALT_LEN, params.N, true);
  view.setUint32(SCRYPT_SALT_LEN + 4, params.p, true);
  view.setUint32(SCRYPT_SALT_LEN + 8, params.r, true);
  encoded.set(nonce, SCRYPT_HEADER_LEN);
  encoded.set(ciphertext, NACL_ENCRYPTED_HEADER_LEN);

  // Best-effort wipe of the derived key bytes once encryption is done.
  derivedKey.fill(0);
  secretBoxKey.fill(0);

  return {
    address: templateJson.address,
    encoded: base64Encode(encoded),
    encoding: {
      content: ['pkcs8', 'sr25519'],
      type: ['scrypt', 'xsalsa20-poly1305'],
      version: '3',
    },
    meta: templateJson.meta ?? {},
  } as KeyringPair$Json;
}

/**
 * Check that the decrypted PKCS8 payload has the expected header/divider
 * structure. This is the same validation @polkadot/keyring does internally.
 *
 * Exported for unit testing.
 */
export function validatePkcs8(decrypted: Uint8Array): void {
  const header = decrypted.slice(0, PKCS8_HEADER.length);
  for (let i = 0; i < PKCS8_HEADER.length; i++) {
    if (header[i] !== PKCS8_HEADER[i]) {
      throw new Error('Decrypted keystore does not have a valid PKCS8 header.');
    }
  }
}

class XxKeyring {
  private keyring: Keyring | null = null;
  private ready: Promise<void> | null = null;

  /** Wait for WASM crypto to initialize. Must be called before any ops. */
  async init(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      await cryptoWaitReady();
      this.keyring = new Keyring({
        type: 'sr25519',
        ss58Format: XX_SS58_PREFIX,
      });
    })();
    return this.ready;
  }

  private ensureReady(): Keyring {
    if (!this.keyring) {
      throw new Error('Keyring not initialized. Call init() first.');
    }
    return this.keyring;
  }

  /** Load all stored accounts from localStorage. */
  listAccounts(): StoredAccount[] {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as StoredAccount[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Check if any account exists (useful to decide onboarding vs dashboard). */
  hasAccounts(): boolean {
    return this.listAccounts().length > 0;
  }

  /** Persist the current list of accounts. */
  private saveAccounts(accounts: StoredAccount[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  }

  /**
   * Generate a new BIP39 mnemonic phrase.
   * The user should back this up BEFORE the account is created.
   */
  generateMnemonic(wordCount: 12 | 24 = 24): string {
    // Words per mnemonic: 12 -> 128 bits entropy, 24 -> 256 bits entropy.
    return mnemonicGenerate(wordCount);
  }

  /** Validate that a mnemonic phrase is well-formed (BIP39). */
  validateMnemonic(mnemonic: string): boolean {
    return mnemonicValidate(mnemonic.trim());
  }

  /**
   * Create a new account from a mnemonic and persist it.
   * The mnemonic should already be validated/confirmed by the user.
   *
   * Implementation note: we use `pair.toJson()` to get the standard PKCS8
   * payload structure, then re-encrypt it at xx-network-strength scrypt
   * (N=131072) instead of @polkadot's weaker N=32768 default. The
   * intermediate decrypted PKCS8 buffer is wiped immediately. See
   * SECURITY.md (H-1) for the rationale.
   */
  async createFromMnemonic(
    mnemonic: string,
    opts: Omit<CreateAccountOptions, 'wordCount'>
  ): Promise<StoredAccount> {
    const keyring = this.ensureReady();
    const trimmed = mnemonic.trim();

    if (!mnemonicValidate(trimmed)) {
      throw new Error('Invalid mnemonic phrase.');
    }

    const pair = keyring.addFromUri(trimmed, { name: opts.name });
    // pair.toJson uses @polkadot's hardcoded N=32768. We use this only as
    // a stepping stone to get the canonical PKCS8 layout, then re-encrypt
    // ourselves with N=131072. The weak JSON is never persisted.
    const weakJson = pair.toJson(opts.password);
    const decrypted = await manualScryptDecrypt(weakJson, opts.password);
    let strongJson: KeyringPair$Json;
    try {
      validatePkcs8(decrypted);
      strongJson = await manualScryptEncrypt(decrypted, opts.password, weakJson);
    } finally {
      // Wipe the intermediate plaintext PKCS8 buffer ASAP.
      decrypted.fill(0);
    }

    // Remove the in-memory pair — we only keep the encrypted JSON.
    keyring.removePair(pair.address);

    const account: StoredAccount = {
      address: pair.address,
      name: opts.name,
      json: strongJson,
      createdAt: Date.now(),
    };

    const accounts = this.listAccounts();
    if (accounts.some((a) => a.address === account.address)) {
      throw new Error('An account with this address already exists.');
    }
    accounts.push(account);
    this.saveAccounts(accounts);

    return account;
  }

  /**
   * Import an account from a Polkadot JSON keystore file.
   *
   * Supports v3 scrypt with custom params (including the N=131072 that
   * wallet.xx.network exports) by manually decrypting instead of relying
   * on @polkadot/keyring's strict default-params-only decrypt.
   *
   * The account is stored with its ORIGINAL encrypted JSON so the user's
   * password continues to work the same way across devices and the main
   * wallet. The unlock() path uses the same manual decrypt.
   */
  async importFromJson(opts: ImportFromJsonOptions): Promise<StoredAccount> {
    const keyring = this.ensureReady();

    // Step 1: Verify the password by manually decrypting with the file's own scrypt params.
    const decrypted = await manualScryptDecrypt(opts.json, opts.password);
    validatePkcs8(decrypted);

    // Step 2: Figure out the address. The JSON already has the SS58-encoded address
    // from the exporting wallet. We re-encode with our SS58 prefix (55) to be safe
    // in case someone imported a non-xx JSON by mistake.
    let address = opts.json.address;
    try {
      const decoded = keyring.decodeAddress(opts.json.address);
      address = keyring.encodeAddress(decoded, XX_SS58_PREFIX);
    } catch {
      // Fall back to the stored address string as-is
    }

    const name = opts.name ?? (opts.json.meta?.name as string) ?? 'Imported';

    const account: StoredAccount = {
      address,
      name,
      json: opts.json,
      createdAt: Date.now(),
    };

    const accounts = this.listAccounts();
    if (accounts.some((a) => a.address === account.address)) {
      throw new Error('An account with this address already exists.');
    }
    accounts.push(account);
    this.saveAccounts(accounts);

    return account;
  }

  /** Delete an account by address. */
  removeAccount(address: string): void {
    const accounts = this.listAccounts().filter((a) => a.address !== address);
    this.saveAccounts(accounts);
  }

  /**
   * Rename an account. Updates BOTH the local display name and the keystore
   * JSON's `meta.name` so the new name survives an export → import round-trip
   * to another device.
   */
  renameAccount(address: string, newName: string): void {
    const accounts = this.listAccounts();
    const acct = accounts.find((a) => a.address === address);
    if (!acct) throw new Error('Account not found.');
    acct.name = newName;
    acct.json = {
      ...acct.json,
      meta: { ...(acct.json.meta || {}), name: newName },
    };
    this.saveAccounts(accounts);
  }

  /**
   * Unlock an account to produce a signing pair.
   *
   * The returned pair holds the decrypted secret key in memory — callers
   * MUST call `pair.lock()` ASAP after signing, and ideally also
   * `xxKeyring.removeFromKeyring(pair.address)` to evict the pair from
   * the in-memory keyring map.
   *
   * Handles both Polkadot-default scrypt params (legacy accounts) and
   * wallet.xx.network custom params (N=131072). We always manually decrypt
   * first, then build the KeyringPair from the raw key material.
   *
   * The intermediate `decrypted` and `secretKey` buffers are zeroed in
   * `finally` blocks. JS Uint8Array.fill is not a guaranteed memory wipe
   * (the engine may have moved the buffer or kept register copies), but
   * it's still meaningfully better than letting the GC decide when —
   * see SECURITY.md (H-2).
   */
  async unlock(address: string, password: string): Promise<KeyringPair> {
    const keyring = this.ensureReady();
    const account = this.listAccounts().find((a) => a.address === address);
    if (!account) throw new Error('Account not found.');

    // Step 1: Manually decrypt to validate the password.
    const decrypted = await manualScryptDecrypt(account.json, password);
    try {
      validatePkcs8(decrypted);

      // Step 2: Extract the secret key and public key from the PKCS8 payload.
      // Layout: [PKCS8_HEADER][64 bytes secretKey][PKCS8_DIVIDER][32 bytes publicKey].
      // Note `slice` returns a copy (not a view), so wiping `decrypted` does
      // not also wipe `secretKey` / `publicKey`.
      const secretStart = PKCS8_HEADER.length;
      const secretKey = decrypted.slice(secretStart, secretStart + 64);
      const dividerStart = secretStart + 64;
      for (let i = 0; i < PKCS8_DIVIDER.length; i++) {
        if (decrypted[dividerStart + i] !== PKCS8_DIVIDER[i]) {
          throw new Error('Decrypted keystore has an invalid PKCS8 divider.');
        }
      }
      const publicKey = decrypted.slice(
        dividerStart + PKCS8_DIVIDER.length,
        dividerStart + PKCS8_DIVIDER.length + 32
      );

      // Step 3: Build a KeyringPair from the raw key material.
      //
      // IMPORTANT: do NOT wipe `secretKey` here. @polkadot/keyring's
      // `addFromPair` retains a reference to (or otherwise depends on)
      // the secretKey buffer for the lifetime of the pair — wiping it
      // immediately after creation collapses the pair's secret state
      // and the next `pair.sign(...)` call fails with
      // "Cannot sign with a locked key pair".
      //
      // The H-2 hardening contract (don't leave plaintext secret material
      // around longer than necessary) is still upheld by:
      //   1. The outer `finally` zeroing the full `decrypted` PKCS8 blob.
      //   2. The mandatory caller-side `pair.lock()` after signing
      //      (documented in this method's docstring; enforced by the
      //      `removeFromKeyring` cleanup pattern in `useTx`).
      // The standalone `secretKey` slice we created above goes out of
      // scope when this function returns and is collectable by the GC;
      // the live secret material lives inside the returned pair, where
      // the caller is responsible for clearing it.
      return keyring.addFromPair(
        { publicKey, secretKey },
        { ...(account.json.meta || {}), name: account.name },
        'sr25519'
      );
    } finally {
      decrypted.fill(0);
    }
  }

  /**
   * Evict an in-memory KeyringPair from @polkadot/keyring's internal map.
   * Callers should invoke this after signing-and-locking is done so the
   * pair object isn't kept alive longer than needed. Safe to call even
   * if the pair isn't in the map (will silently no-op).
   */
  removeFromKeyring(address: string): void {
    try {
      this.keyring?.removePair(address);
    } catch {
      // Ignore — keyring may have already evicted, or pair never existed.
    }
  }

  /**
   * Export an account's encrypted JSON (for backup).
   * The JSON is already encrypted; no password is needed here.
   */
  exportJson(address: string): KeyringPair$Json {
    const account = this.listAccounts().find((a) => a.address === address);
    if (!account) throw new Error('Account not found.');
    return account.json;
  }
}

export const xxKeyring = new XxKeyring();
