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

import type { LedgerSession, LedgerSlots, LedgerTransportKind } from './transport';
import { availableTransports } from './transport';

export type { LedgerSession, LedgerSlots, LedgerTransportKind } from './transport';
export { availableTransports } from './transport';
export { mapLedgerError } from './errors';
export { LedgerSigner } from './signer';

/** Remember the transport that last worked so signing flows reconnect
 *  the same way without re-asking the user. */
const TRANSPORT_PREF_KEY = 'xx-wallet:ledger-transport';

/**
 * True where a Ledger can actually be reached over ANY transport:
 * WebHID (desktop Chromium), WebUSB (desktop + Android Chrome via
 * USB-C/OTG), or Web Bluetooth (Nano X). False on iOS and Firefox —
 * none exist there — and on the HTTP LAN dev URL (not a secure
 * context; localhost still works for desktop dev).
 */
export function isLedgerSupported(): boolean {
  return availableTransports().length > 0;
}

// One session at a time. The promise (not the resolved session) is the
// singleton so concurrent callers share a single in-flight connect
// instead of racing to claim the device.
let sessionPromise: Promise<LedgerSession> | null = null;

function preferredTransport(): LedgerTransportKind {
  const avail = availableTransports();
  try {
    const saved = localStorage.getItem(
      TRANSPORT_PREF_KEY
    ) as LedgerTransportKind | null;
    if (saved && avail.includes(saved)) return saved;
  } catch {
    /* storage unavailable — fall through to default */
  }
  return avail[0];
}

/**
 * Get the shared Ledger session, connecting on first use. The first
 * call should happen inside a user gesture (button tap) — the browser
 * shows its device picker / pairing dialog if the device hasn't been
 * granted yet. Later calls (including reconnects after unplug) reuse
 * the grant silently.
 *
 * `kind` picks the transport explicitly (the add-account flow's
 * USB-vs-Bluetooth buttons). Without it, the last transport that
 * worked is reused — that's how the signing flow reconnects the same
 * way the user originally chose.
 *
 * On any failure the singleton resets so the next attempt starts a
 * fresh connect rather than rejecting forever on a cached error.
 */
export async function getLedgerSession(
  kind?: LedgerTransportKind
): Promise<LedgerSession> {
  if (!isLedgerSupported()) {
    throw new Error('Ledger is not supported in this browser.');
  }
  // An explicit kind that differs from the live session's transport
  // replaces it (e.g., user switches from USB to Bluetooth).
  if (kind && sessionPromise) {
    try {
      const current = await sessionPromise;
      if (current.kind !== kind) {
        await disposeLedgerSession();
      }
    } catch {
      sessionPromise = null;
    }
  }
  if (!sessionPromise) {
    const chosen = kind ?? preferredTransport();
    sessionPromise = (async () => {
      const { createLedgerSession } = await import('./transport');
      const session = await createLedgerSession(chosen);
      try {
        localStorage.setItem(TRANSPORT_PREF_KEY, chosen);
      } catch {
        /* best-effort preference */
      }
      return session;
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
