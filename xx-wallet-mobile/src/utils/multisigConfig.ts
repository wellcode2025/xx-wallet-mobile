/**
 * Multisig configuration JSON — the on-the-wire format for distributing
 * a multisig setup from one signer to others.
 *
 * Distinct from the bytes-package format (utils/bytesPackage.ts):
 *   - bytesPackage carries CALL DATA for a specific pending proposal
 *   - multisigConfig carries the multisig's CONSTITUTION — its
 *     threshold + signer set
 *
 * One leader creates a multisig in their wallet via manual entry,
 * exports as JSON via this format, distributes the file via
 * any channel they trust (Signal, email, AirDrop). Every other signer
 * imports the JSON and the receiving wallet's
 * `parseMultisigConfig` does the integrity check: re-derives the
 * multisig address locally from the JSON's (threshold, signers) and
 * refuses if it doesn't match the JSON's claimed address. That single
 * check makes the JSON safe to send over untrusted carriers — a
 * malicious sender can't smuggle in a different multisig under a
 * familiar address because the math doesn't lie.
 *
 * What the format does NOT carry:
 *   - Per-signer labels — those are local to each wallet. Different
 *     signers can label the same cosigner differently; doesn't affect
 *     the multisig's identity.
 *   - Local nicknames — same reason.
 *   - Anything that would let the sender impose semantics on the
 *     receiver's view of the multisig.
 *
 * The config JSON carries a {threshold, signers, optional name} shape; on
 * import the config is verified by re-deriving the address from its
 * parameters.
 */

import { isValidXxAddress } from './address';
import { multisigAddressMatches } from './multisig';

const FORMAT_TAG = 'xx-wallet-multisig-config';
const FORMAT_VERSION = 1;
const SUGGESTED_NAME_MAX_LEN = 64;

export interface MultisigConfig {
  /** Discriminator — receivers refuse anything they don't recognize. */
  format: typeof FORMAT_TAG;
  /** Schema version for forward compatibility. */
  version: number;
  /** Multisig account address (xx SS58, prefix 55). MUST equal the
   *  locally-derived address from (threshold, signers); receiver
   *  re-checks at import time. */
  multisigAddress: string;
  threshold: number;
  /** Signer addresses. Sorted ascending in the canonical form so the
   *  same set produces a stable JSON regardless of input order. */
  signers: string[];
  /** Optional sender-suggested nickname. Receiver picks their own
   *  local nickname; this is just a starting suggestion. Capped at
   *  64 chars to prevent abuse. */
  suggestedName?: string;
  /** Optional sender-suggested setup-origin hint: 'two-device' marks a
   *  protected account created via the two-device-approval wizard.
   *  Same trust class as suggestedName — the receiving wallet shows it
   *  and lets the user confirm or decline; it is never auto-applied
   *  silently. Only valid on an exactly-2-of-3 config. Older wallets
   *  ignore unknown fields, so this needs no version bump. */
  suggestedPreset?: 'two-device';
  /** Informational only — which signer created the config. The wallet
   *  does NOT authenticate this; it's purely for audit/UX context. */
  createdBy?: string;
  /** ISO 8601 timestamp of when the config was exported. Informational. */
  createdAt?: string;
}

export type MultisigConfigParseResult =
  | { ok: true; config: MultisigConfig }
  | { ok: false; reason: string };

export interface BuildInput {
  multisigAddress: string;
  threshold: number;
  signers: string[];
  suggestedName?: string;
  createdBy?: string;
  /** Setup-origin hint to carry as suggestedPreset. Caller bug to pass
   *  this on anything but an exactly-2-of-3 config — build throws. */
  preset?: 'two-device';
}

/**
 * Build a canonical config from internal data.
 *
 * Throws on invalid input — these are caller bugs we want loud, not
 * silent mis-exports. Caller bugs that would slip through silently
 * include: signer set whose derivation doesn't match the claimed
 * address, invalid signer addresses, threshold out of range.
 */
export function buildMultisigConfig(input: BuildInput): MultisigConfig {
  if (!Number.isInteger(input.threshold) || input.threshold < 1) {
    throw new Error(
      `buildMultisigConfig: threshold must be a positive integer (got ${input.threshold}).`
    );
  }
  if (input.signers.length < 2) {
    throw new Error(
      `buildMultisigConfig: multisig requires at least 2 signers (got ${input.signers.length}).`
    );
  }
  if (input.threshold > input.signers.length) {
    throw new Error(
      `buildMultisigConfig: threshold ${input.threshold} exceeds signer count ${input.signers.length}.`
    );
  }
  if (!isValidXxAddress(input.multisigAddress)) {
    throw new Error(
      `buildMultisigConfig: invalid multisigAddress: ${input.multisigAddress}`
    );
  }
  for (const s of input.signers) {
    if (!isValidXxAddress(s)) {
      throw new Error(
        `buildMultisigConfig: invalid signer address: ${s}`
      );
    }
  }
  // The integrity check that keeps us honest at export time.
  if (
    !multisigAddressMatches(
      input.multisigAddress,
      input.threshold,
      input.signers
    )
  ) {
    throw new Error(
      'buildMultisigConfig: claimed multisigAddress does not match the ' +
        'address derived from the (threshold, signers) tuple. Refusing ' +
        'to produce an inconsistent export.'
    );
  }
  if (
    input.createdBy !== undefined &&
    !isValidXxAddress(input.createdBy)
  ) {
    throw new Error(
      `buildMultisigConfig: createdBy must be a valid xx address (got ${input.createdBy}).`
    );
  }
  if (input.preset !== undefined) {
    if (input.preset !== 'two-device') {
      throw new Error(
        `buildMultisigConfig: unknown preset: ${String(input.preset)}`
      );
    }
    if (input.threshold !== 2 || input.signers.length !== 3) {
      throw new Error(
        'buildMultisigConfig: the two-device preset only applies to a ' +
          `2-of-3 multisig (got ${input.threshold}-of-${input.signers.length}). ` +
          'Refusing to export an inconsistent hint.'
      );
    }
  }

  // Sort signers for canonical form. Same set in any input order
  // produces the same exported JSON (and thus the same configHash).
  const sortedSigners = [...input.signers].sort();

  return {
    format: FORMAT_TAG,
    version: FORMAT_VERSION,
    multisigAddress: input.multisigAddress,
    threshold: input.threshold,
    signers: sortedSigners,
    ...(input.suggestedName
      ? {
          suggestedName: input.suggestedName.slice(0, SUGGESTED_NAME_MAX_LEN),
        }
      : {}),
    ...(input.preset ? { suggestedPreset: input.preset } : {}),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Serialize a config to JSON for file download / QR / copy.
 *
 * Two-space indented for human readability — recipients may open the
 * file in a text editor before importing, and pretty-printed JSON is
 * friendlier to that read-then-import workflow than minified.
 */
export function serializeMultisigConfig(config: MultisigConfig): string {
  return JSON.stringify(config, null, 2);
}

// ---------- Legacy format interop ----------
//
// The official xx wallet (wallet.xx.network) exports multisigs as a flat
// JSON array of signer addresses, with the threshold + name + claimed
// address living in the FILENAME rather than the body:
//
//   ["6Wwj...PojL", "6YDE...VTCQ", "6Z4i...wv1n", "6aA1...KGKp"]
//
// We accept that format too so the foundation's existing exports work
// without manual re-typing. Two important differences from our richer
// format:
//   1. No claimed multisigAddress in the body → no derivation-mismatch
//      check possible. The integrity model becomes "user enters
//      threshold; wallet derives address; user confirms before save".
//   2. The threshold isn't in the body → the user must enter it. We
//      can't auto-import; the legacy file is incomplete on its own.
//
// Filename helper opportunistically pulls the address out of the
// official wallet's filename pattern (`<name>_<addr>_<timestamp>.json`)
// for an informational cross-check after the user picks a threshold.

export interface LegacyMultisigSigners {
  signers: string[];
}

/**
 * Try to parse the official wallet's flat-array export format.
 *
 * Returns the signer list if input is a JSON array of 2+ valid xx
 * network addresses. Returns null on any other shape (caller falls
 * back to whatever the next strategy is, or surfaces an error). Never
 * throws — accepts arbitrary `unknown` input.
 *
 * Validation is intentionally strict: must be an array, every entry
 * must be a string, every string must validate as an xx network SS58
 * address. This stops us from accidentally interpreting a malformed
 * file as a legacy export.
 */
export function parseLegacyMultisigSigners(
  input: unknown
): LegacyMultisigSigners | null {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw)) return null;
  if (raw.length < 2) return null;
  for (const entry of raw) {
    if (typeof entry !== 'string' || !isValidXxAddress(entry)) return null;
  }
  // Sort to canonical order so downstream derivation is deterministic
  // regardless of input order.
  return { signers: [...(raw as string[])].sort() };
}

/**
 * Extract an xx network address from a filename matching the official
 * wallet's export pattern: `<name>_<address>_<timestamp>.json`.
 *
 * Returns the address if the filename contains exactly one substring
 * that looks like a valid xx SS58 (starts with 6, 47-48 chars). Returns
 * null otherwise. Used opportunistically to cross-check the locally-
 * derived address against what the official wallet recorded — an
 * extra gut-check for the user, not a hard verification.
 */
export function extractAddressFromFilename(filename: string): string | null {
  // xx SS58 addresses: start with "6", base58 alphabet, 47-48 chars
  // (varies slightly by encoded value). Loosen to 46-50 to catch any
  // edge-case lengths.
  const matches = filename.match(/6[1-9A-HJ-NP-Za-km-z]{45,49}/g);
  if (!matches) return null;
  for (const candidate of matches) {
    if (isValidXxAddress(candidate)) return candidate;
  }
  return null;
}

/**
 * Parse and validate an incoming multisig config JSON.
 *
 * Returns a discriminated result. `ok: false` carries a human-readable
 * `reason` the caller surfaces to the user; the import is rejected.
 *
 * Validation checks, in order:
 *   1. Format discriminator matches
 *   2. Version is one we handle
 *   3. Required fields present and well-typed
 *   4. Addresses are valid xx network SS58
 *   5. threshold is in range (1..signers.length)
 *   6. **Locally-derived address matches the claimed multisigAddress.**
 *      This is the central security check — it makes JSON safe to
 *      transport over untrusted channels. A tampered config that
 *      changes a signer would derive to a different address than the
 *      one it claims; refusing on mismatch catches the swap.
 *
 * Unknown fields are ignored (forward-compat AND injection safety —
 * extra keys can never affect behavior).
 */
export function parseMultisigConfig(input: unknown): MultisigConfigParseResult {
  // Accept either a parsed object or a JSON string.
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, reason: 'Not valid JSON.' };
    }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Config is not a JSON object.' };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.format !== FORMAT_TAG) {
    return {
      ok: false,
      reason:
        'Not an xx-wallet multisig config (the "format" field is missing or wrong). ' +
        "If you meant to paste call data for a pending proposal, that's a different format.",
    };
  }
  if (typeof obj.version !== 'number' || obj.version > FORMAT_VERSION) {
    return {
      ok: false,
      reason: `Unsupported config version: ${String(obj.version)}. This wallet handles up to v${FORMAT_VERSION}.`,
    };
  }

  if (
    typeof obj.multisigAddress !== 'string' ||
    !isValidXxAddress(obj.multisigAddress)
  ) {
    return {
      ok: false,
      reason: 'multisigAddress missing or not a valid xx address.',
    };
  }
  if (!Number.isInteger(obj.threshold) || (obj.threshold as number) < 1) {
    return {
      ok: false,
      reason: 'threshold missing or not a positive integer.',
    };
  }
  if (!Array.isArray(obj.signers) || obj.signers.length < 2) {
    return {
      ok: false,
      reason: 'signers missing, not an array, or fewer than 2 entries.',
    };
  }
  for (const s of obj.signers) {
    if (typeof s !== 'string' || !isValidXxAddress(s)) {
      return {
        ok: false,
        reason: `One of the signer addresses is invalid: ${String(s)}`,
      };
    }
  }
  if ((obj.threshold as number) > obj.signers.length) {
    return {
      ok: false,
      reason: `threshold ${obj.threshold} exceeds signer count ${obj.signers.length}.`,
    };
  }

  // The single most important check. Without it, a malicious sender
  // could ship a JSON claiming "multisig is at address X" while
  // listing signers that derive to a different address — and the
  // wallet would import a record at address X that's actually
  // controlled by a different signer set. With it, any tampering
  // either changes the derived address (caught here) or doesn't
  // change anything (no attack possible).
  if (
    !multisigAddressMatches(
      obj.multisigAddress,
      obj.threshold as number,
      obj.signers as string[]
    )
  ) {
    return {
      ok: false,
      reason:
        "The multisigAddress in this config does not match what its (threshold, signers) " +
        'derives to locally. The config has been tampered with or is malformed — refusing.',
    };
  }

  // Optional fields — validate types if present, otherwise skip.
  let suggestedName: string | undefined;
  if (obj.suggestedName !== undefined) {
    if (typeof obj.suggestedName !== 'string') {
      return { ok: false, reason: 'suggestedName must be a string if present.' };
    }
    suggestedName = obj.suggestedName.slice(0, SUGGESTED_NAME_MAX_LEN);
  }
  let suggestedPreset: 'two-device' | undefined;
  if (obj.suggestedPreset !== undefined) {
    if (obj.suggestedPreset !== 'two-device') {
      return {
        ok: false,
        reason: `Unknown suggestedPreset: ${String(obj.suggestedPreset)}. This wallet only handles 'two-device'.`,
      };
    }
    // The hint is only meaningful on an exactly-2-of-3 config. Any other
    // shape claiming it is malformed or tampered — fail closed rather
    // than silently dropping the inconsistency.
    if ((obj.threshold as number) !== 2 || obj.signers.length !== 3) {
      return {
        ok: false,
        reason:
          'suggestedPreset "two-device" requires a 2-of-3 multisig, but this ' +
          `config is ${obj.threshold}-of-${obj.signers.length}. The config is ` +
          'malformed — refusing.',
      };
    }
    suggestedPreset = obj.suggestedPreset;
  }
  let createdBy: string | undefined;
  if (obj.createdBy !== undefined) {
    if (typeof obj.createdBy !== 'string' || !isValidXxAddress(obj.createdBy)) {
      return {
        ok: false,
        reason: 'createdBy must be a valid xx address if present.',
      };
    }
    createdBy = obj.createdBy;
  }
  let createdAt: string | undefined;
  if (obj.createdAt !== undefined) {
    if (typeof obj.createdAt !== 'string') {
      return { ok: false, reason: 'createdAt must be an ISO timestamp string if present.' };
    }
    createdAt = obj.createdAt;
  }

  return {
    ok: true,
    config: {
      format: FORMAT_TAG,
      version: obj.version,
      multisigAddress: obj.multisigAddress,
      threshold: obj.threshold as number,
      // Sort signers in the parsed form too — gives consumers a stable
      // canonical ordering regardless of how the sender wrote the JSON.
      signers: [...(obj.signers as string[])].sort(),
      ...(suggestedName ? { suggestedName } : {}),
      ...(suggestedPreset ? { suggestedPreset } : {}),
      ...(createdBy ? { createdBy } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
  };
}
