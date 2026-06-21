/**
 * Multisig coordination message — the wire envelope a memo travels in over e2e.
 *
 * A cosigner proposes a call; their wallet sends a "proposed" message carrying
 * the hash-gated BytesPackage. The other cosigners' wallets parse it, which
 * RE-VERIFIES the package through `parseBytesPackage` (the §6.4/§7.3 hash gate),
 * then surface the DECODED call for approval. Approve/reject acks carry just the
 * multisig + call-hash references (no call data).
 *
 * The envelope is a TRANSPORT, never an instruction. For a "proposed" message
 * only the embedded package is authoritative — it is hash-verified here, and the
 * envelope's other fields are not trusted to drive any signing decision. This is
 * the same rule the wallet already enforces for pasted / QR'd packages; cMix is
 * just another carrier feeding the identical pipeline.
 */
import { isValidXxAddress } from '../utils/address';
import { parseBytesPackage, type BytesPackage } from '../utils/bytesPackage';

const KIND = 'multisig.coordination';
const VERSION = 1;
const CALL_HASH_RE = /^0x[0-9a-f]{64}$/i;

export type CoordinationAction = 'proposed' | 'approved' | 'rejected';

/** A proposal notification carrying the hash-gated call-data package. */
export interface ProposedMessage {
  kind: typeof KIND;
  v: typeof VERSION;
  action: 'proposed';
  /** Derived from the verified package (authoritative). */
  multisigAddress: string;
  /** Derived from the verified package (authoritative). */
  callHash: string;
  /** The call-data package, verified by `parseBytesPackage` at parse time. */
  package: BytesPackage;
}

/** An approve / reject acknowledgement referencing a proposal. */
export interface AckMessage {
  kind: typeof KIND;
  v: typeof VERSION;
  action: 'approved' | 'rejected';
  multisigAddress: string;
  callHash: string;
}

export type CoordinationMessage = ProposedMessage | AckMessage;

export type CoordinationParseResult =
  | { ok: true; message: CoordinationMessage }
  | { ok: false; reason: string };

const encoder = new TextEncoder();

/**
 * Build a "proposed" memo carrying the call-data package. Returns the e2e
 * payload bytes (the package is the only content — the receiver derives the
 * multisig + call hash from it after verifying the gate).
 */
export function buildProposedMessage(pkg: BytesPackage): Uint8Array {
  return encoder.encode(JSON.stringify({ kind: KIND, v: VERSION, action: 'proposed', package: pkg }));
}

/** Build an approve / reject ack referencing a proposal. Returns e2e payload bytes. */
export function buildAckMessage(
  action: 'approved' | 'rejected',
  multisigAddress: string,
  callHash: string
): Uint8Array {
  return encoder.encode(JSON.stringify({ kind: KIND, v: VERSION, action, multisigAddress, callHash }));
}

/**
 * Parse + validate a coordination message (the decoded e2e payload). For a
 * "proposed" message the embedded package is run through `parseBytesPackage`, so
 * the hash gate ALWAYS fires here — a tampered or malformed package is refused
 * at parse and never surfaced to the approval flow.
 */
export function parseCoordinationMessage(input: Uint8Array | string | unknown): CoordinationParseResult {
  let raw: unknown = input;
  if (input instanceof Uint8Array) {
    try {
      raw = JSON.parse(new TextDecoder().decode(input));
    } catch {
      return { ok: false, reason: 'Not valid JSON.' };
    }
  } else if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, reason: 'Not valid JSON.' };
    }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Message is not a JSON object.' };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.kind !== KIND) {
    return { ok: false, reason: 'Not a multisig coordination message.' };
  }
  if (typeof obj.v !== 'number' || obj.v > VERSION) {
    return { ok: false, reason: `Unsupported coordination version: ${String(obj.v)}.` };
  }

  if (obj.action === 'proposed') {
    // The package is the only authoritative content — re-run the hash gate.
    const result = parseBytesPackage(obj.package);
    if (!result.ok) {
      return { ok: false, reason: `Invalid call-data package: ${result.reason}` };
    }
    const pkg = result.package;
    return {
      ok: true,
      message: {
        kind: KIND,
        v: VERSION,
        action: 'proposed',
        multisigAddress: pkg.multisigAddress,
        callHash: pkg.callHash,
        package: pkg,
      },
    };
  }

  if (obj.action === 'approved' || obj.action === 'rejected') {
    if (typeof obj.multisigAddress !== 'string' || !isValidXxAddress(obj.multisigAddress)) {
      return { ok: false, reason: 'multisigAddress missing or not a valid xx address.' };
    }
    if (typeof obj.callHash !== 'string' || !CALL_HASH_RE.test(obj.callHash)) {
      return { ok: false, reason: 'callHash missing or not a 32-byte hex string.' };
    }
    return {
      ok: true,
      message: {
        kind: KIND,
        v: VERSION,
        action: obj.action,
        multisigAddress: obj.multisigAddress,
        callHash: obj.callHash.toLowerCase(),
      },
    };
  }

  return { ok: false, reason: `Unknown coordination action: ${String(obj.action)}.` };
}
