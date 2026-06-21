/**
 * Account-anchored cMix contact binding.
 *
 * Each device has its own per-device cMix identity, but binds its contact to a
 * wallet ACCOUNT by signing it with that account's signing key — the key every
 * device holding the account shares. A peer verifies that signature against the
 * account's known on-chain address (for a cosigner, it's in the multisig), and
 * thereby trusts "this cMix contact belongs to account X, on one of its
 * devices." That binding is what lets us address memos to a cosigner ACCOUNT and
 * fan out to all of its devices — with no central server, no key-sync, and no
 * seed-derived identities. An impostor can't forge a binding: they don't hold
 * the account key, so their signature won't verify against the account's address.
 */
import { signatureVerify } from '@polkadot/util-crypto';
import { isValidXxAddress } from '../utils/address';

/** Domain separator so a binding signature can't be repurposed for anything else. */
const DOMAIN = 'xx-wallet/cmix-contact-binding/v1';

export interface SignedContactBinding {
  /** The wallet account (xx SS58) this contact is bound to. */
  account: string;
  /** The device's cMix contact bytes. */
  cMixContact: Uint8Array;
  /** Signature over `buildContactBindingMessage(account, cMixContact)` by the account key. */
  signature: Uint8Array;
}

/**
 * The canonical, domain-separated message a device signs to bind its cMix
 * contact to an account. Deterministic, so signer and verifier always agree.
 */
export function buildContactBindingMessage(account: string, cMixContact: Uint8Array): Uint8Array {
  const body = `${DOMAIN}\n${account}\n${bytesToBase64(cMixContact)}`;
  return new TextEncoder().encode(body);
}

/**
 * Verify a signed contact binding: the signature must be valid for the binding
 * message under the claimed account's key. Returns false (never throws) on any
 * invalid input. Requires `cryptoWaitReady()` to have completed.
 */
export function verifyContactBinding(binding: SignedContactBinding): boolean {
  if (!binding || !isValidXxAddress(binding.account)) return false;
  try {
    const message = buildContactBindingMessage(binding.account, binding.cMixContact);
    return signatureVerify(message, binding.signature, binding.account).isValid;
  } catch {
    return false;
  }
}

/** Serialize a signed binding to JSON (byte fields as base64) for storage / wire. */
export function serializeSignedBinding(binding: SignedContactBinding): string {
  return JSON.stringify({
    account: binding.account,
    cMixContact: bytesToBase64(binding.cMixContact),
    signature: bytesToBase64(binding.signature),
  });
}

/**
 * Parse a serialized signed binding. Returns null on malformed input. Does NOT
 * verify the signature — the caller must run `verifyContactBinding`.
 */
export function parseSignedBinding(input: string | unknown): SignedContactBinding | null {
  try {
    const raw = typeof input === 'string' ? JSON.parse(input) : input;
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    if (
      typeof obj.account !== 'string' ||
      typeof obj.cMixContact !== 'string' ||
      typeof obj.signature !== 'string'
    ) {
      return null;
    }
    return {
      account: obj.account,
      cMixContact: base64ToBytes(obj.cMixContact),
      signature: base64ToBytes(obj.signature),
    };
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
