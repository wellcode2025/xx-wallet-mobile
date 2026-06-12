/**
 * Ledger module — public surface.
 *
 * This file is intentionally light: capability detection plus a lazy
 * session singleton. The heavy pieces (Buffer polyfill, @ledgerhq
 * transport, @zondax app driver) live in ./transport.ts and load on
 * first use via dynamic import, so the main bundle carries none of it.
 *
 * Capability story: a PWA reaches a Ledger over WebHID, which exists on
 * desktop Chromium and Android Chrome on a secure context — and nowhere
 * on iOS or Firefox. Callers gate every Ledger affordance behind
 * `isLedgerSupported()` so unsupported platforms simply never see the
 * feature (mirroring the isBiometricAvailable() pattern).
 */

import type { LedgerSession, LedgerSlots } from './transport';

export type { LedgerSession, LedgerSlots } from './transport';
export { mapLedgerError } from './errors';
export { LedgerSigner } from './signer';

/**
 * True where a Ledger can actually be reached: secure context + WebHID.
 * False on iOS (no WebHID anywhere), Firefox, and the HTTP LAN dev URL —
 * though localhost counts as a secure context, so desktop dev works.
 */
export function isLedgerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'hid' in navigator
  );
}

// One session at a time. The promise (not the resolved session) is the
// singleton so concurrent callers share a single in-flight connect
// instead of racing to claim the HID interface.
let sessionPromise: Promise<LedgerSession> | null = null;

/**
 * Get the shared Ledger session, connecting on first use. The first
 * call should happen inside a user gesture (button tap) — the browser
 * shows its device picker if the device hasn't been granted yet. Later
 * calls (including reconnects after unplug) reuse the grant silently.
 *
 * On any failure the singleton resets so the next attempt starts a
 * fresh connect rather than rejecting forever on a cached error.
 */
export async function getLedgerSession(): Promise<LedgerSession> {
  if (!isLedgerSupported()) {
    throw new Error('Ledger is not supported in this browser.');
  }
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { createLedgerSession } = await import('./transport');
      return createLedgerSession();
    })();
    sessionPromise.catch(() => {
      // Reset on failure so retry reconnects. The caller still gets the
      // original rejection from their own await.
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

/** Drop and close the shared session (e.g., user unplugged mid-flow). */
export async function disposeLedgerSession(): Promise<void> {
  const p = sessionPromise;
  sessionPromise = null;
  if (p) {
    try {
      const s = await p;
      await s.dispose();
    } catch {
      /* session never materialized — nothing to close */
    }
  }
}

/**
 * Read the address at the given slots. `confirm: true` shows it on the
 * device screen for the user to physically verify — the add-account
 * flow uses that mode so the stored address is the verified one.
 */
export async function getLedgerAddress(
  slots: LedgerSlots,
  confirm = false
): Promise<{ address: string; pubKey: string }> {
  const session = await getLedgerSession();
  const { readLedgerAddress } = await import('./transport');
  try {
    return await readLedgerAddress(session, slots, confirm);
  } catch (e) {
    // A dead transport (unplugged between calls) should reset the
    // singleton so the next attempt reconnects cleanly.
    const msg = e instanceof Error ? e.message : '';
    if (/disconnected|plug it back/i.test(msg)) {
      await disposeLedgerSession();
    }
    throw e;
  }
}
