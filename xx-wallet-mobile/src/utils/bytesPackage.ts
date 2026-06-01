/**
 * Bytes-package JSON format — shared on-the-wire shape for delivering
 * multisig call data from a depositor to a cosigner.
 *
 * One format, three transports, identical wallet-side semantics:
 *   1. File download → user shares via Signal / email / AirDrop / etc.
 *      (manual UX)
 *   2. QR code → in-person handoff
 *   3. Notification service push → automated delivery
 *
 * Designing the format once and using it across all three paths means
 * the verification pipeline is the same regardless of how the bytes
 * arrived: hash-verify, then look up the corresponding pending multisig,
 * then offer for approval. The transport never affects what the wallet
 * does with the payload.
 *
 * The format is versioned and includes a `format` discriminator so a
 * receiver wallet can refuse to process payloads it doesn't understand
 * (rather than silently misinterpret them as something else).
 *
 */

import { isValidXxAddress } from './address';
import { normalizeCallBytes, verifyCallHash } from './decodeCall';

const FORMAT_TAG = 'xx-wallet-multisig-call-data';
const FORMAT_VERSION = 1;

export interface BytesPackage {
  /** Discriminator — receivers refuse anything they don't recognize. */
  format: typeof FORMAT_TAG;
  /** Schema version for forward compatibility. */
  version: number;
  /** Multisig account this proposal is at (xx SS58, prefix 55). */
  multisigAddress: string;
  /** On-chain call hash, 0x-prefixed 64 hex chars (lowercased). */
  callHash: string;
  /** The call data, 0x-prefixed lowercased hex. (Field name is `callData`
   *  in the on-the-wire JSON to use Substrate-canonical terminology — call
   *  data, call hash, extrinsic, deposit — in user-facing strings.) */
  callData: string;
  /** The depositor's signer address (the signer who made the proposal). */
  proposedBy: string;
  /** Timepoint of the original proposal, required for any approve / cancel
   *  transaction against it. */
  proposedAt: { block: number; index: number };
}

/** Return type from `parseBytesPackage`. Discriminated union — `ok: true`
 *  means the package validated AND its bytes hash to the claimed hash;
 *  `ok: false` carries a human-readable reason for refusing. */
export type BytesPackageParseResult =
  | { ok: true; package: BytesPackage }
  | { ok: false; reason: string };

/**
 * Build a canonical bytes-package from internal data.
 *
 * Throws if `callBytes` doesn't hash to `callHash` — that's a caller
 * bug (the inputs disagree about what the proposal is) and we want it
 * loud so it never silently produces an unverifiable export. The very
 * point of this format is to be hash-verifiable; producing one that
 * isn't would be a security regression masquerading as a feature.
 */
export function buildBytesPackage(input: {
  multisigAddress: string;
  callHash: string;
  /** Raw call data hex. Internal callers may still call this `callBytes`
   *  on their side — the rename is for the on-the-wire format only.
   *  We accept the param name `callData` here for consistency with the
   *  output field. */
  callData: string;
  proposedBy: string;
  proposedAt: { block: number; index: number };
}): BytesPackage {
  const callData = normalizeCallBytes(input.callData);
  const callHash = input.callHash.toLowerCase();
  if (!verifyCallHash(callData, callHash)) {
    throw new Error(
      'buildBytesPackage: callData does not hash to the claimed callHash. ' +
        'Refusing to produce an unverifiable package.'
    );
  }
  if (!isValidXxAddress(input.multisigAddress)) {
    throw new Error(
      `buildBytesPackage: invalid multisigAddress: ${input.multisigAddress}`
    );
  }
  if (!isValidXxAddress(input.proposedBy)) {
    throw new Error(
      `buildBytesPackage: invalid proposedBy address: ${input.proposedBy}`
    );
  }
  return {
    format: FORMAT_TAG,
    version: FORMAT_VERSION,
    multisigAddress: input.multisigAddress,
    callHash,
    callData,
    proposedBy: input.proposedBy,
    proposedAt: { ...input.proposedAt },
  };
}

/**
 * Serialize a bytes-package to canonical JSON for file download / QR / etc.
 *
 * Two-space-indented for human readability when downloaded as a `.json`
 * file — the file may be opened in a text editor by a curious cosigner
 * before they import it, and pretty-printed JSON is friendlier to that
 * read-then-import workflow than minified.
 */
export function serializeBytesPackage(pkg: BytesPackage): string {
  return JSON.stringify(pkg, null, 2);
}

/**
 * Parse and validate an incoming bytes-package JSON. Returns a
 * discriminated result — caller checks `result.ok` and either consumes
 * `result.package` or surfaces `result.reason` to the user.
 *
 * Validation includes:
 *   - Format discriminator matches our tag
 *   - Version is one we know how to handle
 *   - Required fields present and well-typed
 *   - Multisig + proposer addresses validate as xx network SS58
 *   - callHash is well-formed hex
 *   - **callBytes hash to callHash** — the load-bearing security check
 *
 * The hash check at parse time means receivers never see a "good-looking"
 * package whose bytes don't actually correspond to the claimed hash.
 * Tampering is caught here, before the wallet hands the package to the
 * approval flow.
 *
 * Unknown fields in the input are silently ignored (forward compatibility:
 * future versions can add fields without breaking older parsers, AND extra
 * fields injected by an attacker can never affect behavior).
 */
export function parseBytesPackage(input: unknown): BytesPackageParseResult {
  // Accept either a parsed object OR a JSON string (the file/QR paths
  // both end up as strings; the notification service ends up parsed).
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, reason: 'Not valid JSON.' };
    }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Package is not a JSON object.' };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.format !== FORMAT_TAG) {
    return {
      ok: false,
      reason:
        'Not an xx-wallet multisig call-data package (the "format" field is missing or wrong).',
    };
  }
  if (typeof obj.version !== 'number' || obj.version > FORMAT_VERSION) {
    return {
      ok: false,
      reason: `Unsupported package version: ${String(obj.version)}. This wallet handles up to v${FORMAT_VERSION}.`,
    };
  }

  if (
    typeof obj.multisigAddress !== 'string' ||
    !isValidXxAddress(obj.multisigAddress)
  ) {
    return { ok: false, reason: 'multisigAddress missing or not a valid xx address.' };
  }
  if (typeof obj.proposedBy !== 'string' || !isValidXxAddress(obj.proposedBy)) {
    return { ok: false, reason: 'proposedBy missing or not a valid xx address.' };
  }
  if (typeof obj.callHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(obj.callHash)) {
    return { ok: false, reason: 'callHash missing or not a 32-byte hex string.' };
  }
  if (typeof obj.callData !== 'string' || !/^0x[0-9a-f]+$/i.test(obj.callData)) {
    return { ok: false, reason: 'callData missing or not a hex string.' };
  }
  const proposedAt = obj.proposedAt as Record<string, unknown> | undefined;
  if (
    !proposedAt ||
    typeof proposedAt.block !== 'number' ||
    typeof proposedAt.index !== 'number'
  ) {
    return {
      ok: false,
      reason: 'proposedAt missing or not in {block: number, index: number} form.',
    };
  }

  // Final and most important: the call data must actually hash to the
  // claimed hash. Without this check, an attacker who can write to the
  // user's file system (or intercept the QR transport) could swap the
  // call data while leaving the claimed hash alone — and the wallet
  // would happily surface a pending proposal with mismatched data to
  // the approval flow.
  const normalizedData = normalizeCallBytes(obj.callData);
  const normalizedHash = (obj.callHash as string).toLowerCase();
  if (!verifyCallHash(normalizedData, normalizedHash)) {
    return {
      ok: false,
      reason:
        'The call data in this package does not hash to the claimed call hash. ' +
        'The package may be corrupted or tampered with — refusing.',
    };
  }

  return {
    ok: true,
    package: {
      format: FORMAT_TAG,
      version: obj.version,
      multisigAddress: obj.multisigAddress,
      proposedBy: obj.proposedBy,
      callHash: normalizedHash,
      callData: normalizedData,
      proposedAt: {
        block: proposedAt.block,
        index: proposedAt.index,
      },
    },
  };
}
