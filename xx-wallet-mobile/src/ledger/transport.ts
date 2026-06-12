/**
 * Ledger transport + app session. The heavy half of the ledger module —
 * everything here (Buffer polyfill, @ledgerhq transport, @zondax app
 * driver) loads via dynamic import so users who never touch a Ledger
 * never download a byte of it. Import this module ONLY through the lazy
 * accessors in ./index.ts.
 *
 * Connection model: one session at a time. WebHID exposes the device as
 * an exclusive interface — a second open() while Ledger Live (or another
 * tab) holds it fails with "unable to claim interface", which errors.ts
 * maps to an actionable message.
 *
 * First connect requires a user gesture (the browser shows a device
 * picker). After the user grants the device once, subsequent connects
 * reuse the permission silently — which is what lets the signing flow
 * reconnect without a picker mid-transaction.
 */

import type Transport from '@ledgerhq/hw-transport';
import type { SubstrateApp } from '@zondax/ledger-substrate';
import { LEDGER_OK, isLedgerRpcResponse, mapLedgerError } from './errors';

/** BIP44 slots for m/44'/1955'/account'/change'/index' (all hardened). */
export interface LedgerSlots {
  account: number;
  change: number;
  index: number;
}

export interface LedgerSession {
  app: SubstrateApp;
  transport: Transport;
  /** xx app version as reported by the device, e.g. "1.203.2". */
  appVersion: string;
  /** Close the transport. Safe to call twice. */
  dispose(): Promise<void>;
}

/**
 * Open the WebHID transport and construct the XXNetwork app driver.
 * Throws mapped, user-actionable errors on every failure path.
 */
export async function createLedgerSession(): Promise<LedgerSession> {
  // The Zondax driver builds APDUs with Node's Buffer. Vite doesn't
  // polyfill Node globals, so install the `buffer` package's
  // implementation before the driver loads. Done via dynamic import
  // (not static) so the assignment is guaranteed to run first.
  const { Buffer } = await import('buffer');
  const g = globalThis as { Buffer?: typeof Buffer };
  if (typeof g.Buffer === 'undefined') {
    g.Buffer = Buffer;
  }

  const [{ default: TransportWebHID }, zondax] = await Promise.all([
    import('@ledgerhq/hw-transport-webhid'),
    import('@zondax/ledger-substrate'),
  ]);

  let transport: Transport;
  try {
    // Tries already-granted devices first; falls back to the browser's
    // device picker (which needs a user gesture).
    transport = await TransportWebHID.create();
  } catch (e) {
    throw new Error(mapLedgerError(e));
  }

  try {
    // The registry entry carries the xx app's CLA (0xa3), slip44 (1955)
    // and SS58 prefix (55) — verified against a real device.
    const app = zondax.newSubstrateApp(transport, 'XXNetwork');

    // Prove the xx app is actually open before handing the session out.
    // Wrong app / dashboard / locked device all surface here with a
    // status word that errors.ts turns into "open the app" guidance.
    const version = await app.getVersion();
    if (version.return_code !== LEDGER_OK) {
      throw version;
    }

    return {
      app,
      transport,
      appVersion: `${version.major}.${version.minor}.${version.patch}`,
      async dispose() {
        try {
          await transport.close();
        } catch {
          /* already closed / unplugged — nothing to release */
        }
      },
    };
  } catch (e) {
    // Don't leak a claimed HID interface on a failed handshake.
    try {
      await transport.close();
    } catch {
      /* ignore */
    }
    // APDU responses and raw transport throws both get mapped; an Error
    // that was already mapped upstream passes through untouched.
    throw isLedgerRpcResponse(e) || !(e instanceof Error)
      ? new Error(mapLedgerError(e))
      : e;
  }
}

/**
 * Read the address at the given derivation slots. With `confirm` the
 * device shows the address on its screen and waits for the user — use
 * that for the add-account flow so what the wallet stores is what the
 * user physically verified.
 */
export async function readLedgerAddress(
  session: LedgerSession,
  slots: LedgerSlots,
  confirm: boolean
): Promise<{ address: string; pubKey: string }> {
  const r = await session.app.getAddress(
    slots.account,
    slots.change,
    slots.index,
    confirm
  );
  if (r.return_code !== LEDGER_OK) {
    throw new Error(mapLedgerError(r));
  }
  if (!r.address.startsWith('6')) {
    // Mangle guard — same policy as every other address decode path in
    // the wallet. A wrong-prefix address here would mean the registry
    // entry or the app changed underneath us; refuse loudly.
    throw new Error(
      `Ledger returned a non-xx address (${r.address.slice(0, 8)}…) — expected an address starting with "6".`
    );
  }
  return { address: r.address, pubKey: r.pubKey };
}

/**
 * Sign raw extrinsic-payload bytes at the given slots. Returns the
 * 65-byte MultiSignature-encoded signature (leading 0x00 = ed25519),
 * which is exactly what a polkadot-js `SignerResult` wants in hex.
 */
export async function signWithLedger(
  session: LedgerSession,
  slots: LedgerSlots,
  payloadBytes: Uint8Array
): Promise<Uint8Array> {
  const { Buffer } = await import('buffer');
  const r = await session.app.sign(
    slots.account,
    slots.change,
    slots.index,
    Buffer.from(payloadBytes)
  );
  if (r.return_code !== LEDGER_OK || !r.signature) {
    throw new Error(mapLedgerError(r));
  }
  return new Uint8Array(r.signature);
}
