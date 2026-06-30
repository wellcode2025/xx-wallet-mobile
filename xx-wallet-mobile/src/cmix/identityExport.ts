/**
 * Portable cMix messaging identity — encrypted export / import.
 *
 * The messaging identity (the marshalled reception identity) is a self-contained
 * credential: the SAME identity reconstitutes on another device, so the user
 * stays reachable as the same contact after migrating or reinstalling (proven
 * end-to-end in the e2e spike — export bytes → fresh client → identical reception
 * ID). It is exported encrypted under the DEDICATED MESSAGING PASSPHRASE, so the
 * blob is useless without it, and importing on another device uses the same
 * passphrase.
 *
 * The envelope is a small JSON wrapper (magic + version + the wrapped blob) so a
 * paste or file can be recognised and version-checked before we try to decrypt.
 * The wrapped blob reuses the storage-secret scheme (scrypt N=131072 +
 * xsalsa20-poly1305) — the same audited crypto + bounds as the keystore.
 *
 * SECURITY: the decrypted bytes are the PRIVATE messaging identity. Never display
 * or transmit them raw; only ever the passphrase-encrypted envelope, and only at
 * the user's explicit request (it's an account-export-grade action).
 */
import { wrapSecret, unwrapSecret } from './storageSecret';

/** Marks a blob as an xx messaging-identity export. */
const MAGIC = 'XXMSGID';
/** Envelope format version (the inner blob carries its own scrypt params). */
const VERSION = 1;
/** File extension + MIME for the downloadable form. */
export const EXPORT_FILE_NAME = 'xx-messaging-identity.xxid';
export const EXPORT_MIME = 'application/json';

interface IdentityExportEnvelope {
  magic: string;
  v: number;
  /** base64 of wrapSecret(identityBytes, passphrase). */
  blob: string;
  /** Short, NON-secret reception-ID fragment, for display/verification only. */
  idHint?: string;
}

/**
 * Encrypt the marshalled reception identity under the messaging passphrase,
 * returning the envelope as a JSON string (suitable for copy-paste or a file).
 */
export async function encryptIdentityExport(
  identity: Uint8Array,
  passphrase: string,
  idHint?: string
): Promise<string> {
  const blob = await wrapSecret(identity, passphrase);
  const envelope: IdentityExportEnvelope = { magic: MAGIC, v: VERSION, blob, idHint };
  return JSON.stringify(envelope);
}

/**
 * Parse + decrypt an export envelope back to the identity bytes. Throws a
 * user-meaningful error on a non-envelope, a newer-version envelope, or a wrong
 * passphrase (the inner unwrap fails closed). Pure over the injected text.
 */
export async function decryptIdentityExport(text: string, passphrase: string): Promise<Uint8Array> {
  let envelope: IdentityExportEnvelope;
  try {
    envelope = JSON.parse(text.trim());
  } catch {
    throw new Error("That doesn't look like a messaging-identity export.");
  }
  if (!envelope || envelope.magic !== MAGIC || typeof envelope.blob !== 'string') {
    throw new Error("That doesn't look like an xx messaging-identity export.");
  }
  if (typeof envelope.v !== 'number' || envelope.v > VERSION) {
    throw new Error('This export was made by a newer version of the wallet — please update.');
  }
  // unwrapSecret throws 'Incorrect password…' on a wrong passphrase (fail-closed).
  return unwrapSecret(envelope.blob, passphrase);
}

/** Read the non-secret reception-ID hint from an envelope, for display before
 *  decryption (e.g. "you're importing identity 3ea94da5"). Null if absent/bad. */
export function readIdHint(text: string): string | null {
  try {
    const envelope = JSON.parse(text.trim()) as IdentityExportEnvelope;
    return envelope?.magic === MAGIC && typeof envelope.idHint === 'string' ? envelope.idHint : null;
  } catch {
    return null;
  }
}

/** A short, non-secret reception-ID fragment for display. Pure. */
export function idHintFrom(receptionId: Uint8Array): string {
  return Array.from(receptionId.slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join('');
}
