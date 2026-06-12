/**
 * Ledger error mapping — turns transport/device failures into messages a
 * person standing at their phone or desk can act on.
 *
 * Two error families arrive here:
 *   1. Zondax app responses: `{ return_code, error_message }` objects with
 *      APDU status words (0x9000 = ok, anything else = a specific failure).
 *   2. Transport-layer throws: DOMExceptions from WebHID (picker dismissed,
 *      device claimed by another tab/app) and Ledger transport errors.
 *
 * Every mapped message states what to DO, not just what went wrong, and the
 * raw underlying detail is appended so support/debugging never loses the
 * original cause (mobile PWAs have no console to go digging in).
 */

/** Shape of a Zondax app response that carries an APDU status. */
export interface LedgerRpcResponse {
  return_code: number;
  error_message?: string;
}

/** APDU status word for success. */
export const LEDGER_OK = 0x9000;

/** True if the value looks like a Zondax `{return_code}` response. */
export function isLedgerRpcResponse(e: unknown): e is LedgerRpcResponse {
  return (
    !!e &&
    typeof e === 'object' &&
    typeof (e as LedgerRpcResponse).return_code === 'number'
  );
}

/**
 * Map any Ledger-originated failure to an actionable user-facing message.
 * Always returns a string — unknown causes fall through to a generic
 * message that still carries the raw detail.
 */
export function mapLedgerError(e: unknown): string {
  // --- Zondax APDU status words -------------------------------------
  if (isLedgerRpcResponse(e)) {
    const raw = e.error_message ? ` (${e.error_message})` : '';
    switch (e.return_code) {
      case LEDGER_OK:
        return 'No error.';
      case 0x6e00: // CLA not supported — wrong app is open
      case 0x6e01: // "App does not seem to be open"
        return 'Open the xx network app on your Ledger, then try again.';
      case 0x6986: // command not allowed — user pressed reject
        return 'Rejected on the Ledger device.';
      case 0x6984: {
        // Data invalid — the app could not parse the payload. Three known
        // sub-causes observed against app 1.203.2, distinguished by the
        // error_message text.
        const msg = (e.error_message ?? '').toLowerCase();
        if (msg.includes('method not supported')) {
          return 'The Ledger xx network app does not support this type of transaction.';
        }
        if (msg.includes('nesting')) {
          return 'The Ledger xx network app cannot sign batched calls — submit the steps one at a time.';
        }
        return `The Ledger xx network app could not read this transaction${raw}.`;
      }
      case 0x5515: // device locked
        return 'Unlock your Ledger device, then try again.';
      default:
        return `Ledger returned an unexpected status 0x${e.return_code.toString(16)}${raw}.`;
    }
  }

  // --- Transport-layer throws ----------------------------------------
  if (e instanceof Error) {
    const msg = e.message.toLowerCase();
    const name = (e as { name?: string }).name ?? '';
    // Bluetooth-specific failures first — they often arrive with
    // generic DOMException names, so match on message content. The raw
    // message rides along in every branch (mobile has no console, and
    // BLE failures have many distinct causes that all look the same
    // without it — per the surface-error-message policy).
    if (msg.includes('bluetooth')) {
      if (msg.includes('unavailable') || msg.includes('adapter')) {
        return (
          "Bluetooth isn't available — turn on Bluetooth on this device, " +
          `and on the Nano X enable it under Settings → Bluetooth. (${e.message})`
        );
      }
      return (
        'Bluetooth connection failed. Make sure Bluetooth is on, the ' +
        'Nano X is unlocked with the xx network app open, and Bluetooth ' +
        'is enabled on the Nano (Settings → Bluetooth). If the Nano is ' +
        "paired in this phone's Bluetooth settings or used by the Ledger " +
        `Live app, unpair it / close Ledger Live first. (${e.message})`
      );
    }
    if (msg.includes('gatt')) {
      return (
        'The Bluetooth link to the Ledger dropped. If the Nano X is ' +
        "paired in this phone's Bluetooth settings, forget it there and " +
        'close the Ledger Live app (it holds the connection) — then ' +
        'toggle Bluetooth off and on in the Nano\'s own Settings and ' +
        `try again. (${e.message})`
      );
    }
    if (name === 'TransportOpenUserCancelled' || name === 'NotFoundError') {
      // People miss the open-the-app step constantly — a Ledger sitting
      // on its dashboard is invisible to the wallet, so the full ritual
      // goes in the message: connect, unlock, open the app, pick it.
      return (
        'No Ledger found. Connect the device (plug it in, or for ' +
        'Bluetooth make sure both sides have it on), unlock it, and ' +
        'open the xx network app on it (the wallet can only see the ' +
        'Ledger while that app is open) — then try again and pick the ' +
        "device from the browser's prompt."
      );
    }
    if (name === 'SecurityError') {
      return 'The browser blocked USB access — Ledger only works on a secure (HTTPS) page.';
    }
    if (
      name === 'InvalidStateError' ||
      msg.includes('unable to claim interface') ||
      msg.includes('already open')
    ) {
      return 'Another app is using the Ledger — close Ledger Live (and other wallet tabs), then try again.';
    }
    if (msg.includes('disconnected') || msg.includes('device was disconnected')) {
      return 'The Ledger was disconnected — plug it back in, open the xx network app on it, and try again.';
    }
    if (msg.includes('locked')) {
      return 'Unlock your Ledger device, then try again.';
    }
    return `Ledger error: ${e.message}`;
  }

  return `Ledger error: ${String(e)}`;
}
