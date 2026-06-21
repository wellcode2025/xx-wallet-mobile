/**
 * Tests for the pure receive-decode path in the messaging service:
 * a raw incoming e2e message (marshalled bindings.Message JSON, base64 payload)
 * → the validated, hash-gated coordination message. The connect/send/receive
 * orchestration is integration-level and not unit-tested.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { hexToU8a } from '@polkadot/util';
import { blake2AsHex, cryptoWaitReady } from '@polkadot/util-crypto';
import { buildBytesPackage, type BytesPackage } from '../utils/bytesPackage';
import { buildAckMessage, buildProposedMessage } from './coordinationMessage';
import { decodeCoordinationPayload } from './messaging';

const ADDR_MULTISIG = '6ZihnXBA64KAFFGfdYHxKWeWKLpw28pxPANjuSWsPp1HnU8M';
const ADDR_DEPOSITOR = '6WwjYDmMb3MuoXvWHN357UzHY9VsJpFbJYbgQ1Vz1aY2PojL';

const SAMPLE_CALL_BYTES =
  '0x040300' +
  '6e1ee5ff89f7f5c0d61f93e4b4f8a2d51e0bbf3a4c5d6e7f8091a2b3c4d5e6f7' +
  '0700' +
  '0070c9b28b2904';

/** Wrap coordination payload bytes the way the e2e listener delivers them: a
 *  marshalled bindings.Message JSON whose `Payload` is the base64 of the bytes. */
function wrapAsE2eMessage(coordinationBytes: Uint8Array): Uint8Array {
  const text = new TextDecoder().decode(coordinationBytes);
  const message = JSON.stringify({ MessageType: 2, Payload: btoa(text), Sender: 'sender' });
  return new TextEncoder().encode(message);
}

let validPkg: BytesPackage;

beforeAll(async () => {
  await cryptoWaitReady();
  validPkg = buildBytesPackage({
    multisigAddress: ADDR_MULTISIG,
    callHash: blake2AsHex(hexToU8a(SAMPLE_CALL_BYTES), 256),
    callData: SAMPLE_CALL_BYTES,
    proposedBy: ADDR_DEPOSITOR,
    proposedAt: { block: 1, index: 0 },
  });
});

describe('decodeCoordinationPayload', () => {
  it('decodes a wrapped ack message end to end', () => {
    const hash = '0x' + 'ab'.repeat(32);
    const wrapped = wrapAsE2eMessage(buildAckMessage('approved', ADDR_MULTISIG, hash));
    const result = decodeCoordinationPayload(wrapped);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.action).toBe('approved');
      expect(result.message.callHash).toBe(hash);
    }
  });

  it('decodes a wrapped proposal and the package survives the hash gate', () => {
    const wrapped = wrapAsE2eMessage(buildProposedMessage(validPkg));
    const result = decodeCoordinationPayload(wrapped);
    expect(result.ok).toBe(true);
    if (result.ok && result.message.action === 'proposed') {
      expect(result.message.package).toEqual(validPkg);
    }
  });

  it('rejects a wrapped non-coordination payload', () => {
    const wrapped = wrapAsE2eMessage(new TextEncoder().encode('{"kind":"something.else","v":1}'));
    expect(decodeCoordinationPayload(wrapped).ok).toBe(false);
  });

  it('rejects when the proposal package is tampered (hash gate fires)', () => {
    const tampered = JSON.stringify({
      kind: 'multisig.coordination',
      v: 1,
      action: 'proposed',
      package: { ...validPkg, callData: '0xdeadbeef' },
    });
    const wrapped = wrapAsE2eMessage(new TextEncoder().encode(tampered));
    expect(decodeCoordinationPayload(wrapped).ok).toBe(false);
  });
});
