/**
 * Tests for the Ledger error mapping — the layer that turns APDU status
 * words and transport throws into actionable on-screen messages. Status
 * words and message texts are pinned to what a real Nano X running xx
 * app 1.203.2 actually returned, so a regression here means the message
 * users see for a real failure mode went generic or wrong.
 */

import { describe, expect, it } from 'vitest';
import { LEDGER_OK, isLedgerRpcResponse, mapLedgerError } from './errors';

describe('isLedgerRpcResponse', () => {
  it('recognizes Zondax response shapes and rejects everything else', () => {
    expect(isLedgerRpcResponse({ return_code: 0x9000 })).toBe(true);
    expect(
      isLedgerRpcResponse({ return_code: 0x6984, error_message: 'x' })
    ).toBe(true);
    expect(isLedgerRpcResponse(new Error('nope'))).toBe(false);
    expect(isLedgerRpcResponse(null)).toBe(false);
    expect(isLedgerRpcResponse('0x9000')).toBe(false);
    expect(isLedgerRpcResponse({ error_message: 'no code' })).toBe(false);
  });
});

describe('mapLedgerError — APDU status words (pinned to device behavior)', () => {
  it('app not open → open-the-app guidance (both observed codes)', () => {
    // Observed on-device: getVersion with the app closed.
    expect(
      mapLedgerError({
        return_code: 0x6e01,
        error_message: 'App does not seem to be open',
      })
    ).toMatch(/open the xx network app/i);
    expect(mapLedgerError({ return_code: 0x6e00 })).toMatch(
      /open the xx network app/i
    );
  });

  it('user rejection → rejected message', () => {
    expect(mapLedgerError({ return_code: 0x6986 })).toMatch(
      /rejected on the ledger/i
    );
  });

  it('0x6984 variants: method unsupported / nesting / parse failure', () => {
    // Observed: democracy.vote probe.
    expect(
      mapLedgerError({
        return_code: 0x6984,
        error_message: 'Method not supported',
      })
    ).toMatch(/does not support this type of transaction/i);
    // Observed: utility.batchAll([bond, nominate]) probe.
    expect(
      mapLedgerError({
        return_code: 0x6984,
        error_message: 'Call nesting not supported',
      })
    ).toMatch(/one at a time/i);
    // Observed: multisig.approveAsMulti probe (WeightV2 parse failure).
    expect(
      mapLedgerError({
        return_code: 0x6984,
        error_message: 'Unexpected buffer end',
      })
    ).toMatch(/could not read this transaction.*unexpected buffer end/is);
  });

  it('locked device → unlock guidance', () => {
    expect(mapLedgerError({ return_code: 0x5515 })).toMatch(/unlock/i);
  });

  it('unknown status word carries the hex code and raw detail', () => {
    const msg = mapLedgerError({
      return_code: 0x6f42,
      error_message: 'mystery',
    });
    expect(msg).toMatch(/0x6f42/);
    expect(msg).toMatch(/mystery/);
  });
});

describe('mapLedgerError — transport-layer throws', () => {
  function namedError(name: string, message: string): Error {
    const e = new Error(message);
    e.name = name;
    return e;
  }

  it('no device / dismissed picker → full connect ritual incl. opening the app', () => {
    // The open-the-app step is the one users miss (Aaron's field
    // feedback 2026-06-12) — both no-device messages must carry it.
    const cancelled = mapLedgerError(
      namedError('TransportOpenUserCancelled', 'cancelled')
    );
    expect(cancelled).toMatch(/plug it in/i);
    expect(cancelled).toMatch(/open the xx network app/i);
    const notFound = mapLedgerError(namedError('NotFoundError', 'no device'));
    expect(notFound).toMatch(/open the xx network app/i);
  });

  it('Bluetooth failures → enable-Bluetooth guidance incl. the Nano X setting', () => {
    expect(
      mapLedgerError(new Error('Bluetooth adapter unavailable'))
    ).toMatch(/settings → bluetooth/i);
    expect(
      mapLedgerError(new Error('Web Bluetooth pairing failed'))
    ).toMatch(/bluetooth/i);
    expect(mapLedgerError(new Error('GATT operation failed'))).toMatch(
      /bluetooth link.*dropped/i
    );
  });

  it('claimed interface → close Ledger Live guidance', () => {
    expect(
      mapLedgerError(new Error('Unable to claim interface.'))
    ).toMatch(/close ledger live/i);
    expect(
      mapLedgerError(namedError('InvalidStateError', 'busy'))
    ).toMatch(/close ledger live/i);
  });

  it('disconnect mid-flow → plug back in + reopen the app', () => {
    const msg = mapLedgerError(new Error('The device was disconnected.'));
    expect(msg).toMatch(/plug it back in/i);
    expect(msg).toMatch(/open the xx network app/i);
  });

  it('unknown Error and non-Error fall through with detail preserved', () => {
    expect(mapLedgerError(new Error('weird thing'))).toBe(
      'Ledger error: weird thing'
    );
    expect(mapLedgerError(42)).toBe('Ledger error: 42');
  });
});

describe('LEDGER_OK', () => {
  it('is the APDU success word', () => {
    expect(LEDGER_OK).toBe(0x9000);
  });
});
