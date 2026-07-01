/**
 * Portable cMix messaging identities — encrypted export / import.
 *
 * A backup bundles ALL of the user's account messaging identities (one per
 * account they message as) so that restoring on another device makes every one
 * of them reachable again as the same contact. Each identity is a self-contained
 * credential (proven in the e2e spike: export bytes → fresh client → identical
 * reception ID); the whole set is encrypted under the DEDICATED MESSAGING
 * PASSPHRASE, so the blob is useless without it, and importing uses the same
 * passphrase.
 *
 * The envelope is a small JSON wrapper (magic + version + a non-secret count +
 * the wrapped blob) so a paste or file can be recognised + version-checked before
 * we try to decrypt. The wrapped blob reuses the storage-secret scheme (scrypt
 * N=131072 + xsalsa20-poly1305) — the same audited crypto + bounds as the keystore.
 *
 * SECURITY: the decrypted bytes are the PRIVATE messaging identities. Never
 * display or transmit them raw; only ever the passphrase-encrypted envelope, and
 * only at the user's explicit request (account-export-grade action).
 */
import { base64Decode, base64Encode } from '@polkadot/util-crypto';
import { wrapSecret, unwrapSecret } from './storageSecret';

/** Marks a blob as an xx messaging-identity backup. */
const MAGIC = 'XXMSGID';
/** Envelope format version. v2 bundles all account identities (v1 was a single). */
const VERSION = 2;
/** File extension + MIME for the downloadable form. */
export const EXPORT_FILE_NAME = 'xx-messaging-identities.xxid';
export const EXPORT_MIME = 'application/json';

/** One account's messaging identity in a backup. */
export interface IdentityBackupEntry {
  /** The wallet account (SS58) this identity belongs to. */
  account: string;
  /** The marshalled reception identity bytes. */
  identity: Uint8Array;
}

interface IdentitiesEnvelope {
  magic: string;
  v: number;
  /** base64 of wrapSecret(JSON payload, passphrase). */
  blob: string;
  /** NON-secret count of bundled identities, for display before decrypt. */
  count?: number;
}

/**
 * Encrypt all the user's account identities under the messaging passphrase,
 * returning the envelope as a JSON string (suitable for copy-paste or a file).
 */
export async function encryptIdentitiesExport(
  entries: IdentityBackupEntry[],
  passphrase: string
): Promise<string> {
  const payload = JSON.stringify({
    entries: entries.map((e) => ({ account: e.account, identity: base64Encode(e.identity) })),
  });
  const blob = await wrapSecret(new TextEncoder().encode(payload), passphrase);
  const envelope: IdentitiesEnvelope = { magic: MAGIC, v: VERSION, blob, count: entries.length };
  return JSON.stringify(envelope);
}

/**
 * Parse + decrypt a backup envelope back to the account identities. Throws a
 * user-meaningful error on a non-backup, a newer-version envelope, a wrong
 * passphrase (the inner unwrap fails closed), or a corrupt payload.
 */
export async function decryptIdentitiesExport(
  text: string,
  passphrase: string
): Promise<IdentityBackupEntry[]> {
  let envelope: IdentitiesEnvelope;
  try {
    envelope = JSON.parse(text.trim());
  } catch {
    throw new Error("That doesn't look like a messaging-identity backup.");
  }
  if (!envelope || envelope.magic !== MAGIC || typeof envelope.blob !== 'string') {
    throw new Error("That doesn't look like an xx messaging-identity backup.");
  }
  if (typeof envelope.v !== 'number' || envelope.v > VERSION) {
    throw new Error('This backup was made by a newer version of the wallet — please update.');
  }

  // unwrapSecret throws 'Incorrect password…' on a wrong passphrase (fail-closed).
  const payloadBytes = await unwrapSecret(envelope.blob, passphrase);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    throw new Error('Backup is corrupt.');
  }
  const list = (parsed as { entries?: unknown })?.entries;
  if (!Array.isArray(list)) throw new Error('Backup is corrupt.');

  const out: IdentityBackupEntry[] = [];
  for (const e of list) {
    const account = (e as { account?: unknown })?.account;
    const identity = (e as { identity?: unknown })?.identity;
    if (typeof account === 'string' && typeof identity === 'string') {
      try {
        out.push({ account, identity: base64Decode(identity) });
      } catch {
        /* skip a malformed entry rather than failing the whole restore */
      }
    }
  }
  if (out.length === 0) throw new Error('Backup contained no identities.');
  return out;
}

/** Read the non-secret identity count from a backup envelope, for display before
 *  decryption (e.g. "restoring 3 identities"). Null if absent/unrecognised. */
export function readBackupCount(text: string): number | null {
  try {
    const envelope = JSON.parse(text.trim()) as IdentitiesEnvelope;
    return envelope?.magic === MAGIC && typeof envelope.count === 'number' ? envelope.count : null;
  } catch {
    return null;
  }
}
