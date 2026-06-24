/**
 * Device-bound key for "stay enabled on this device".
 *
 * Wraps the cMix messaging secret under a NON-EXTRACTABLE AES-GCM key kept in
 * IndexedDB, so the device can rejoin the mixnet without re-entering the account
 * password each session. The key material never leaves the browser (the
 * CryptoKey is stored structured-cloned; its bytes are not accessible to JS), so
 * a passive read of localStorage — where the wrapped blob lives, in the cMix
 * secret store — can't decrypt it. It's bound to this origin + browser profile.
 *
 * Scope of the protection: this is a CONVENIENCE measure for a COMMS identity,
 * not funds. It does not let anyone sign or spend (that's the account keystore).
 * Active same-origin script could still use the key, like any web secret —
 * device-level security is the app lock's job. Opt-in, never the default.
 *
 * No xxDK / wasm dependency: plain WebCrypto + IndexedDB. Throws if those APIs
 * are unavailable (very old browsers) — callers fall back to the password flow.
 */

const DB_NAME = 'xx-wallet-device-key';
const STORE = 'keys';
const KEY_ID = 'cmix-device-key';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readKey(): Promise<CryptoKey | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const val = await idbRequest(tx.objectStore(STORE).get(KEY_ID));
    return (val as CryptoKey | undefined) ?? null;
  } finally {
    db.close();
  }
}

async function writeKey(key: CryptoKey): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await idbRequest(tx.objectStore(STORE).put(key, KEY_ID));
  } finally {
    db.close();
  }
}

/** Get the device key, generating + persisting one on first use. */
async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  const existing = await readKey();
  if (existing) return existing;
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable — bytes never leave the browser
    ['encrypt', 'decrypt']
  );
  await writeKey(key);
  return key;
}

/** Whether a device key exists (i.e. "stay enabled" was set up here). */
export async function hasDeviceKey(): Promise<boolean> {
  return (await readKey()) !== null;
}

/** Encrypt `secret` under the device key → base64(iv ‖ ciphertext). */
export async function wrapWithDeviceKey(secret: Uint8Array): Promise<string> {
  const key = await getOrCreateDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toBuffer(iv) }, key, toBuffer(secret))
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return bytesToBase64(out);
}

/** Decrypt a blob produced by `wrapWithDeviceKey`. Throws if the key is gone
 *  (e.g. storage cleared) or the blob is corrupt — callers fall back to the
 *  password flow. */
export async function unwrapWithDeviceKey(blob: string): Promise<Uint8Array> {
  const key = await readKey();
  if (!key) throw new Error('No device key on this device.');
  const bytes = base64ToBytes(blob);
  if (bytes.length <= 12) throw new Error('Malformed device-wrapped secret.');
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBuffer(iv) }, key, toBuffer(ct));
  return new Uint8Array(pt);
}

/** Forget the device key (turning "stay enabled" off / resetting messaging). */
export async function clearDeviceKey(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    await idbRequest(tx.objectStore(STORE).delete(KEY_ID));
  } finally {
    db.close();
  }
}

/**
 * Copy a view into a fresh, standalone ArrayBuffer. WebCrypto wants a
 * BufferSource backed by ArrayBuffer (not SharedArrayBuffer); this guarantees
 * that and sidesteps the lib.dom `Uint8Array<ArrayBufferLike>` strictness.
 */
function toBuffer(view: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(view.byteLength);
  new Uint8Array(buf).set(view);
  return buf;
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
