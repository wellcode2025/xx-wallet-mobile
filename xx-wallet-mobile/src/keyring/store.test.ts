/**
 * Tests for manualScryptDecrypt — the load-bearing crypto path that lets
 * this wallet import keystores exported by wallet.xx.network.
 *
 * Why this test matters:
 * The official wallet exports v3 keystores with scrypt N=131072, which
 * @polkadot/util-crypto rejects because of a hardcoded params assertion.
 * Our manualScryptDecrypt bypasses that assertion. If a future @polkadot
 * upgrade or a refactor in store.ts breaks this path, users importing
 * wallet.xx.network keystores get cryptic failures and we lose the wallet's
 * single biggest onboarding advantage. These tests are a tripwire.
 *
 * Test fixtures are built programmatically using scrypt-js + tweetnacl
 * (already runtime deps) so there are no checked-in keystore files with
 * fake-but-real-looking accounts.
 */

import { describe, expect, it } from 'vitest';
import { scrypt as scryptAsync } from 'scrypt-js';
import nacl from 'tweetnacl';
import { stringToU8a } from '@polkadot/util';
import { base64Decode, base64Encode } from '@polkadot/util-crypto';
import type { KeyringPair$Json } from '@polkadot/keyring/types';
import { manualScryptDecrypt, validatePkcs8 } from './store';

// PKCS8 header/divider — must match the constants in store.ts exactly.
// Duplicated here intentionally; if store.ts ever changes these, the test
// should fail loudly so we know to update both sides.
const PKCS8_HEADER = new Uint8Array([
  48, 83, 2, 1, 1, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32,
]);
const PKCS8_DIVIDER = new Uint8Array([161, 35, 3, 33, 0]);

// Deterministic test material — bytes are arbitrary; we just need the
// function to round-trip them. Real Substrate keys are not required here
// because manualScryptDecrypt does no signing or curve validation.
const SECRET_KEY = new Uint8Array(64).fill(0xab);
const PUBLIC_KEY = new Uint8Array(32).fill(0xcd);
const PASSWORD = 'correct-horse-battery-staple';

// Reproducible (not cryptographically meaningful) salt + nonce for tests.
function deterministicSalt(): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = i + 1;
  return out;
}
function deterministicNonce(): Uint8Array {
  const out = new Uint8Array(24);
  for (let i = 0; i < 24; i++) out[i] = i + 100;
  return out;
}

/** Assemble the PKCS8 payload around a keypair. */
function buildPkcs8(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const out = new Uint8Array(
    PKCS8_HEADER.length + 64 + PKCS8_DIVIDER.length + 32
  );
  let o = 0;
  out.set(PKCS8_HEADER, o);
  o += PKCS8_HEADER.length;
  out.set(secretKey, o);
  o += 64;
  out.set(PKCS8_DIVIDER, o);
  o += PKCS8_DIVIDER.length;
  out.set(publicKey, o);
  return out;
}

/**
 * Build a v3 encrypted keystore JSON for the given params, encrypting the
 * given secret/public key pair. Lets us produce both Polkadot-default and
 * wallet.xx.network-style fixtures from one helper.
 */
async function buildEncryptedJson(
  secretKey: Uint8Array,
  publicKey: Uint8Array,
  password: string,
  N: number,
  r = 8,
  p = 1
): Promise<KeyringPair$Json> {
  const pkcs8 = buildPkcs8(secretKey, publicKey);
  const salt = deterministicSalt();
  const nonce = deterministicNonce();

  const derivedKey = await scryptAsync(
    stringToU8a(password),
    salt,
    N,
    r,
    p,
    64
  );
  const secretBoxKey = derivedKey.slice(0, 32);
  const ciphertext = nacl.secretbox(pkcs8, nonce, secretBoxKey);

  // Pack: [salt 32][N 4 LE][p 4 LE][r 4 LE][nonce 24][ciphertext]
  const encoded = new Uint8Array(32 + 4 + 4 + 4 + 24 + ciphertext.length);
  encoded.set(salt, 0);
  const view = new DataView(encoded.buffer);
  view.setUint32(32, N, true);
  view.setUint32(36, p, true);
  view.setUint32(40, r, true);
  encoded.set(nonce, 44);
  encoded.set(ciphertext, 68);

  return {
    encoded: base64Encode(encoded),
    encoding: {
      content: ['pkcs8', 'sr25519'],
      type: ['scrypt', 'xsalsa20-poly1305'],
      version: '3',
    },
    address: 'test-address',
    meta: { name: 'test' },
  } as KeyringPair$Json;
}

/**
 * Take a valid encrypted JSON and tamper with the N/p/r fields in the
 * header to test the bounds-checking logic without re-running scrypt.
 */
function tamperParams(
  json: KeyringPair$Json,
  fields: { N?: number; p?: number; r?: number }
): KeyringPair$Json {
  const encoded = base64Decode(json.encoded);
  const view = new DataView(encoded.buffer, encoded.byteOffset);
  if (fields.N !== undefined) view.setUint32(32, fields.N, true);
  if (fields.p !== undefined) view.setUint32(36, fields.p, true);
  if (fields.r !== undefined) view.setUint32(40, fields.r, true);
  return { ...json, encoded: base64Encode(encoded) };
}

describe('manualScryptDecrypt', () => {
  describe('successful decryption', () => {
    it('round-trips a Polkadot-default N=32768 keystore', async () => {
      const json = await buildEncryptedJson(SECRET_KEY, PUBLIC_KEY, PASSWORD, 32768);
      const decrypted = await manualScryptDecrypt(json, PASSWORD);

      validatePkcs8(decrypted);

      // PKCS8 layout: header(16) | secretKey(64) | divider(5) | publicKey(32)
      expect(decrypted.slice(16, 80)).toEqual(SECRET_KEY);
      expect(decrypted.slice(85, 117)).toEqual(PUBLIC_KEY);
    });

    it('round-trips a wallet.xx.network-style N=131072 keystore', async () => {
      // This is the case @polkadot/util-crypto refuses and the whole reason
      // manualScryptDecrypt exists. If this regresses, importing keystores
      // exported by the official wallet stops working.
      const json = await buildEncryptedJson(SECRET_KEY, PUBLIC_KEY, PASSWORD, 131072);
      const decrypted = await manualScryptDecrypt(json, PASSWORD);

      validatePkcs8(decrypted);
      expect(decrypted.slice(16, 80)).toEqual(SECRET_KEY);
      expect(decrypted.slice(85, 117)).toEqual(PUBLIC_KEY);
    });
  });

  describe('failure modes', () => {
    it('throws on incorrect password', async () => {
      const json = await buildEncryptedJson(SECRET_KEY, PUBLIC_KEY, PASSWORD, 32768);
      await expect(
        manualScryptDecrypt(json, 'wrong-password')
      ).rejects.toThrow(/Incorrect password/i);
    });

    it('rejects N below the 1024 sanity floor', async () => {
      const valid = await buildEncryptedJson(SECRET_KEY, PUBLIC_KEY, PASSWORD, 32768);
      const tampered = tamperParams(valid, { N: 512 });
      await expect(manualScryptDecrypt(tampered, PASSWORD)).rejects.toThrow(/out-of-range/i);
    });

    it('rejects N above the 1048576 sanity ceiling', async () => {
      const valid = await buildEncryptedJson(SECRET_KEY, PUBLIC_KEY, PASSWORD, 32768);
      const tampered = tamperParams(valid, { N: 2097152 });
      await expect(manualScryptDecrypt(tampered, PASSWORD)).rejects.toThrow(/out-of-range/i);
    });

    it('rejects N that is not a power of two', async () => {
      const valid = await buildEncryptedJson(SECRET_KEY, PUBLIC_KEY, PASSWORD, 32768);
      const tampered = tamperParams(valid, { N: 30000 });
      await expect(manualScryptDecrypt(tampered, PASSWORD)).rejects.toThrow(/power of two/i);
    });

    it('rejects p below 1', async () => {
      const valid = await buildEncryptedJson(SECRET_KEY, PUBLIC_KEY, PASSWORD, 32768);
      const tampered = tamperParams(valid, { p: 0 });
      await expect(manualScryptDecrypt(tampered, PASSWORD)).rejects.toThrow(/out-of-range/i);
    });

    it('rejects p above 8', async () => {
      const valid = await buildEncryptedJson(SECRET_KEY, PUBLIC_KEY, PASSWORD, 32768);
      const tampered = tamperParams(valid, { p: 9 });
      await expect(manualScryptDecrypt(tampered, PASSWORD)).rejects.toThrow(/out-of-range/i);
    });

    it('rejects r above 16', async () => {
      const valid = await buildEncryptedJson(SECRET_KEY, PUBLIC_KEY, PASSWORD, 32768);
      const tampered = tamperParams(valid, { r: 17 });
      await expect(manualScryptDecrypt(tampered, PASSWORD)).rejects.toThrow(/out-of-range/i);
    });
  });
});

describe('validatePkcs8', () => {
  it('accepts a payload with the canonical header', async () => {
    const json = await buildEncryptedJson(SECRET_KEY, PUBLIC_KEY, PASSWORD, 32768);
    const decrypted = await manualScryptDecrypt(json, PASSWORD);
    expect(() => validatePkcs8(decrypted)).not.toThrow();
  });

  it('rejects a payload with a corrupted header', () => {
    const corrupt = new Uint8Array(120);
    corrupt[0] = 0xff; // wrong first byte
    expect(() => validatePkcs8(corrupt)).toThrow(/PKCS8 header/i);
  });
});
