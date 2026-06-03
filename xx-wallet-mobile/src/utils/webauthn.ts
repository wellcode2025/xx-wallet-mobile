/**
 * WebAuthn biometric helpers for the app lock.
 *
 * Used as a local "user verification" gate (fingerprint / face) — NOT
 * server authentication, since the wallet has no backend. A successful
 * assertion just means the platform authenticator performed a biometric
 * check; we then unlock. The PIN remains the required fallback, and the
 * keys are unaffected (still encrypted with the signing password).
 *
 * Requires a SECURE CONTEXT (HTTPS or localhost). On the plain-HTTP dev
 * URL, isBiometricAvailable() returns false and the option is hidden —
 * so biometrics are testable on the HTTPS deploy, not the LAN dev URL.
 * Also returns false on devices with no platform authenticator (e.g. many
 * desktops), so it's only ever offered where it actually works.
 */

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBuf(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Random bytes as a fresh ArrayBuffer (not a typed-array view), so it
 * satisfies the WebAuthn BufferSource types without SharedArrayBuffer
 * ambiguity under TS's stricter typed-array generics.
 */
function randomBytes(n: number): ArrayBuffer {
  const buf = new ArrayBuffer(n);
  crypto.getRandomValues(new Uint8Array(buf));
  return buf;
}

/**
 * True only when a platform authenticator (biometric) is usable here:
 * secure context + WebAuthn + a verifying platform authenticator present.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    if (
      !window.isSecureContext ||
      typeof window.PublicKeyCredential === 'undefined' ||
      !window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
    ) {
      return false;
    }
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Create a platform credential and return its id (base64) to persist.
 * Throws if the user cancels or the platform refuses.
 */
export async function enrollBiometric(): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: 'xx Wallet', id: window.location.hostname },
      user: {
        id: randomBytes(16),
        name: 'xx-wallet-app-lock',
        displayName: 'xx Wallet',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      attestation: 'none',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Biometric setup was cancelled.');
  return bufToB64(cred.rawId);
}

/**
 * Prompt the platform authenticator for the stored credential. Returns
 * true on a successful (user-verified) assertion, false on cancel/failure.
 */
export async function verifyBiometric(
  credentialIdB64: string
): Promise<boolean> {
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: window.location.hostname,
        allowCredentials: [
          { type: 'public-key', id: b64ToBuf(credentialIdB64) },
        ],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return assertion !== null;
  } catch {
    return false;
  }
}
