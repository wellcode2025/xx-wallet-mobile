/**
 * xx network multisig utilities.
 *
 * A Substrate multisig account address is deterministically derived from its
 * (threshold, sorted-signers) tuple via:
 *
 *   blake2_256("modlpy/utilisuba" || SCALE-encoded-sorted-signers || threshold-as-u16-LE)
 *
 * @polkadot/util-crypto's `createKeyMulti` implements this; we wrap it to
 * encode the result as an xx network SS58 address (prefix 55).
 *
 * The derivation is what makes JSON config sharing safe: every signer can
 * recompute the multisig address from the same parameters, so a malicious
 * config that claims "this multisig is at address X" can be caught by
 * re-deriving locally and checking the claim.
 *
 * **The wallet must NEVER trust an externally-supplied multisig address
 * without re-deriving it from the (threshold, signers) tuple it claims.**
 *
 * (Address derivation follows the Substrate multisig scheme; order-independent
 * on the sorted signer set.) The JSON config interchange format carries
 * {threshold, signers, optional name}.
 *
 * Crypto pre-init: `createKeyMulti` uses blake2 from @polkadot's WASM
 * crypto. Callers must ensure `cryptoWaitReady()` has resolved before
 * invoking these functions. The wallet's keyring already does this at
 * app startup; tests await it themselves.
 */

import {
  createKeyMulti,
  decodeAddress,
  encodeAddress,
} from '@polkadot/util-crypto';
import { isValidXxAddress } from './address';
import { XX_SS58_PREFIX } from '../api/constants';

/**
 * Derive the multisig account address for a given (threshold, signers) tuple.
 *
 * Returns the SS58-encoded address using the xx network prefix (55).
 *
 * Throws on:
 *   - non-positive or non-integer threshold
 *   - threshold > signers.length
 *   - fewer than 2 signers (single-signer "multisig" doesn't use pallet_multisig
 *     at all — it's just a regular account, and treating it as a multisig hides
 *     a caller bug)
 *   - any signer not a valid xx network SS58 address
 *
 * The derivation is order-independent: createKeyMulti sorts the signer set
 * internally before hashing, so callers can pass the array in any order
 * and get the same result. We deliberately do NOT sort here so that any
 * UI-side ordering bug stays visible (the caller's mental model of "what
 * order are these signers in" is theirs to manage; the derivation is ours).
 */
export function deriveMultisigAddress(
  threshold: number,
  signers: string[]
): string {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error(
      `Invalid multisig threshold: ${threshold} (must be a positive integer).`
    );
  }
  if (signers.length < 2) {
    throw new Error(
      `Multisig requires at least 2 signers (got ${signers.length}). ` +
        `Single-signer accounts don't use pallet_multisig.`
    );
  }
  if (threshold > signers.length) {
    throw new Error(
      `Threshold ${threshold} exceeds signer count ${signers.length}.`
    );
  }
  // Validate every signer. A typo'd address would silently produce a
  // different multisig address than the caller expected, costing whoever
  // funds it.
  for (const s of signers) {
    if (!isValidXxAddress(s)) {
      throw new Error(`Invalid xx network address in signer set: ${s}`);
    }
  }

  const publicKey = createKeyMulti(signers, threshold);
  return encodeAddress(publicKey, XX_SS58_PREFIX);
}

/**
 * Verify that a claimed multisig address matches what (threshold, signers)
 * derives to.
 *
 * This is the central security check used during JSON config import (Path B
 * in the design doc) and during approval-time verification of out-of-band
 * call data. Mismatch is the caller's signal to refuse the operation
 * entirely — never to render a "this might be wrong" warning and proceed.
 *
 * Returns false (rather than throwing) on bad input. The check is meant to
 * be a guard, not a validator — its only job is to distinguish "yes the
 * claim is consistent with the parameters" from "no, refuse this".
 *
 * Tolerates a claimed address that's correctly derived but encoded with a
 * different SS58 prefix (e.g., a paste from a Polkadot/Kusama-format display)
 * by normalizing both sides to xx format before comparing.
 */
export function multisigAddressMatches(
  claimedAddress: string,
  threshold: number,
  signers: string[]
): boolean {
  let derived: string;
  try {
    derived = deriveMultisigAddress(threshold, signers);
  } catch {
    return false;
  }
  const normalize = (a: string): string | null => {
    try {
      return encodeAddress(decodeAddress(a), XX_SS58_PREFIX);
    } catch {
      return null;
    }
  };
  const a = normalize(claimedAddress);
  const b = normalize(derived);
  return a !== null && b !== null && a === b;
}

/**
 * Produce the canonical JSON form of a multisig configuration for hashing.
 *
 * Canonicalization rules:
 *   - Signers sorted ascending (so the same set in any order produces the
 *     same canonical form)
 *   - Keys emitted in a fixed order (so JSON.stringify gives a stable result)
 *   - No optional metadata — only the cryptographic essentials (threshold +
 *     sorted signers). Local nicknames, `suggestedName`, `createdBy`, etc.
 *     intentionally do NOT participate in the hash, so two signers can
 *     label the same multisig differently while their stored configHash
 *     fields agree.
 *
 * Used by `configHashOf` and by the JSON config import path
 * for change detection.
 */
export function canonicalConfigJson(
  threshold: number,
  signers: string[]
): string {
  const sorted = [...signers].sort();
  return JSON.stringify({ threshold, signers: sorted });
}

/**
 * SHA-256 hex digest of the canonical config JSON.
 *
 * Used as the `configHash` field on Multisig records. Two imports of the
 * same (threshold, signers) tuple — regardless of input order or which
 * import path created them — produce the same configHash.
 *
 * Async because WebCrypto's `subtle.digest` is async and the wallet runs
 * in browser contexts. On HTTP dev contexts where `crypto.subtle` is
 * unavailable we fall back to a non-cryptographic but stable hash so the
 * wallet remains operable in the LAN-dev workflow we documented (see
 * deferred memory: secure-context API pattern). This fallback is fine for
 * configHash because it's a *dedup* signal, not a security primitive — the
 * security primitive is `multisigAddressMatches`, which is independent of
 * this and covered by SubtleCrypto-free derivation.
 */
export async function configHashOf(
  threshold: number,
  signers: string[]
): Promise<string> {
  const json = canonicalConfigJson(threshold, signers);
  const bytes = new TextEncoder().encode(json);

  // Production HTTPS path
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // HTTP dev / no-secure-context fallback. Not cryptographically strong
  // and not intended to be — see the docstring above. Marked with a
  // distinguishing prefix so the value is recognizably non-canonical
  // (won't accidentally be compared against a real SHA-256 elsewhere).
  let h = 5381;
  for (let i = 0; i < bytes.length; i++) {
    h = ((h << 5) + h + bytes[i]) | 0;
  }
  console.warn(
    'multisig.configHashOf: crypto.subtle unavailable (non-secure context); ' +
      'using non-cryptographic dedup hash. This is fine for local dedup but ' +
      'should not happen in production HTTPS.'
  );
  return `dev-djb2-${(h >>> 0).toString(16)}`;
}
