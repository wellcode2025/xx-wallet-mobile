/**
 * Encrypted storage for the per-device cMix EKV secret.
 *
 * The cMix session encrypts the messaging identity + node-registration keys at
 * rest with a 32-byte storage secret. We keep that secret wrapped under a wallet
 * account's password, reusing the SAME scheme the keystore uses (scrypt N=131072
 * + xsalsa20-poly1305), so the messaging identity is protected as strongly as
 * the account itself. Going online unlocks the account anyway (to sign the
 * contact binding), so unwrapping here adds no separate password step.
 *
 * This is an independent, parallel implementation of the keystore's wrap format.
 * It deliberately does NOT import keyring/store.ts internals (a hard-rule file);
 * the byte layout mirrors the v3 keystore so the same audited scrypt bounds
 * apply. The secret can't be derived from the account key (sr25519 signing is
 * non-deterministic), so it is random and must be persisted wrapped.
 */
import { stringToU8a } from '@polkadot/util';
import { base64Decode, base64Encode } from '@polkadot/util-crypto';
import { scrypt as scryptAsync } from 'scrypt-js';
import nacl from 'tweetnacl';

/** Length of the cMix storage secret (used directly as the session storage password). */
export const STORAGE_SECRET_LEN = 32;

// Byte layout, mirroring the v3 keystore encoded field:
//   [0..32]   scrypt salt
//   [32..36]  N (uint32 LE)
//   [36..40]  p (uint32 LE)
//   [40..44]  r (uint32 LE)
//   [44..68]  secretbox nonce (24)
//   [68..]    secretbox ciphertext
const SALT_LEN = 32;
const HEADER_LEN = 44; // salt + N + p + r
const NONCE_LEN = 24;
const ENC_HEADER_LEN = HEADER_LEN + NONCE_LEN; // 68

// Strong params, matching the keystore (and wallet.xx.network).
const STRONG_N = 131072;
const STRONG_R = 8;
const STRONG_P = 1;

/** A fresh random cMix storage secret (the session storage password). */
export function generateStorageSecret(): Uint8Array {
  return nacl.randomBytes(STORAGE_SECRET_LEN);
}

/**
 * Wrap a secret under a password → base64 blob. Fresh salt + nonce every call.
 * The derived key bytes are best-effort wiped after use.
 */
export async function wrapSecret(secret: Uint8Array, password: string): Promise<string> {
  const salt = nacl.randomBytes(SALT_LEN);
  const nonce = nacl.randomBytes(NONCE_LEN);
  const derived = await scryptAsync(stringToU8a(password), salt, STRONG_N, STRONG_R, STRONG_P, 64);
  const key = derived.slice(0, 32);
  const ciphertext = nacl.secretbox(secret, nonce, key);

  const encoded = new Uint8Array(ENC_HEADER_LEN + ciphertext.length);
  encoded.set(salt, 0);
  const view = new DataView(encoded.buffer);
  view.setUint32(SALT_LEN, STRONG_N, true);
  view.setUint32(SALT_LEN + 4, STRONG_P, true);
  view.setUint32(SALT_LEN + 8, STRONG_R, true);
  encoded.set(nonce, HEADER_LEN);
  encoded.set(ciphertext, ENC_HEADER_LEN);

  derived.fill(0);
  key.fill(0);
  return base64Encode(encoded);
}

/**
 * Unwrap a base64 blob under a password. Throws on a wrong password, a too-short
 * blob, or out-of-range scrypt params (same audited bounds as the keystore: the
 * dominant risk is a crafted blob OOM-ing the tab via scrypt's ~128*N*r working
 * set, so N/r/p are capped).
 */
export async function unwrapSecret(wrapped: string, password: string): Promise<Uint8Array> {
  const encoded = base64Decode(wrapped);
  if (encoded.length < ENC_HEADER_LEN) {
    throw new Error('Wrapped secret is too short.');
  }
  const salt = encoded.slice(0, SALT_LEN);
  const view = new DataView(encoded.buffer, encoded.byteOffset);
  const N = view.getUint32(SALT_LEN, true);
  const p = view.getUint32(SALT_LEN + 4, true);
  const r = view.getUint32(SALT_LEN + 8, true);

  if (N < 1024 || N > 262144 || p < 1 || p > 4 || r < 1 || r > 8) {
    throw new Error('Wrapped secret has out-of-range scrypt params.');
  }
  if ((N & (N - 1)) !== 0) {
    throw new Error('Wrapped secret scrypt N is not a power of two.');
  }

  const derived = await scryptAsync(stringToU8a(password), salt, N, r, p, 64);
  const key = derived.slice(0, 32);
  const nonce = encoded.slice(HEADER_LEN, HEADER_LEN + NONCE_LEN);
  const ciphertext = encoded.slice(ENC_HEADER_LEN);
  const secret = nacl.secretbox.open(ciphertext, nonce, key);
  derived.fill(0);
  key.fill(0);
  if (!secret) {
    throw new Error('Incorrect password for this wrapped secret.');
  }
  return secret;
}
