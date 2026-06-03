/**
 * App-lock PIN hashing.
 *
 * The PIN gates *opening the app* (a privacy / speed-bump layer) — it does
 * NOT protect the keys, which stay encrypted with the signing password.
 * So this is deliberately lightweight, but still salted + scrypt-stretched
 * so the stored hash isn't trivially reversible.
 *
 * Uses scrypt-js (pure JS) + crypto.getRandomValues so it works in an
 * insecure context too (the dev server runs on plain HTTP, where
 * crypto.subtle is unavailable).
 */

import { scrypt } from 'scrypt-js';

/** Minimum PIN length. Digits only, but longer is allowed. */
export const PIN_MIN_LENGTH = 6;

// Moderate cost — runs on every unlock, so kept lighter than the keystore's
// N=131072. Brute-forcing the *hash* only exposes app access (balance
// viewing), never funds, so this is a sensible balance.
const N = 16384;
const R = 8;
const P = 1;
const DK_LEN = 32;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** A fresh random 16-byte salt, hex-encoded. */
export function randomSaltHex(): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return toHex(salt);
}

/** Derive the scrypt hash of a PIN against a salt, hex-encoded. */
export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const pwd = new TextEncoder().encode(pin);
  const dk = await scrypt(pwd, fromHex(saltHex), N, R, P, DK_LEN);
  return toHex(dk);
}

/** Constant-time-ish check of a PIN against a stored salt + hash. */
export async function verifyPin(
  pin: string,
  saltHex: string,
  hashHex: string
): Promise<boolean> {
  const computed = await hashPin(pin, saltHex);
  if (computed.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return diff === 0;
}
