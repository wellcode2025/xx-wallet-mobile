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
import { buildAckMessage, buildProposedMessage, parseCoordinationMessage } from './coordinationMessage';
import type { SendResult } from './e2e';
import {
  decodeCoordinationPayload,
  eagerLoginList,
  incomingProposalFrom,
  pollUntil,
  sendMemoTo,
  sendProposalToCosigners,
  type CosignerTarget,
  type AccountMessaging,
} from './messaging';
import type { ChatMemo } from './chatMessage';

const noSleep = () => Promise.resolve();

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

describe('incomingProposalFrom', () => {
  it('extracts the cacheable call data from a verified proposal', () => {
    const inc = incomingProposalFrom(parseCoordinationMessage(buildProposedMessage(validPkg)));
    expect(inc).not.toBeNull();
    expect(inc?.multisigAddress).toBe(validPkg.multisigAddress);
    expect(inc?.callHash).toBe(validPkg.callHash);
    expect(inc?.callBytes).toBe(validPkg.callData);
    expect(inc?.proposedBy).toBe(validPkg.proposedBy);
  });

  it('returns null for an ack (nothing to cache)', () => {
    const ack = parseCoordinationMessage(buildAckMessage('approved', ADDR_MULTISIG, '0x' + 'ab'.repeat(32)));
    expect(incomingProposalFrom(ack)).toBeNull();
  });

  it('returns null for a parse failure', () => {
    expect(incomingProposalFrom({ ok: false, reason: 'nope' })).toBeNull();
  });
});

describe('eagerLoginList', () => {
  it('puts the primary first and appends the others', () => {
    expect(eagerLoginList('A', ['B', 'C'])).toEqual(['A', 'B', 'C']);
  });

  it('dedupes the primary out of the others (order preserved)', () => {
    expect(eagerLoginList('B', ['A', 'B', 'C', 'A'])).toEqual(['B', 'A', 'C']);
  });

  it('is just the primary when there are no others', () => {
    expect(eagerLoginList('A')).toEqual(['A']);
    expect(eagerLoginList('A', [])).toEqual(['A']);
  });
});

describe('pollUntil', () => {
  it('returns true immediately when the predicate already holds', async () => {
    let sleeps = 0;
    const ok = await pollUntil(() => true, 1000, 100, async () => {
      sleeps++;
    });
    expect(ok).toBe(true);
    expect(sleeps).toBe(0);
  });

  it('returns true once the predicate flips, sleeping between polls', async () => {
    let calls = 0;
    let sleeps = 0;
    const ok = await pollUntil(() => ++calls >= 3, 1000, 100, async () => {
      sleeps++;
    });
    expect(ok).toBe(true);
    expect(sleeps).toBe(2); // true on the 3rd check → slept twice
  });

  it('gives up after ceil(timeout/interval) polls when never true', async () => {
    let sleeps = 0;
    const ok = await pollUntil(() => false, 1000, 250, async () => {
      sleeps++;
    });
    expect(ok).toBe(false);
    expect(sleeps).toBe(4); // ceil(1000/250)
  });
});

describe('sendProposalToCosigners', () => {
  const target = (n: number): CosignerTarget => ({
    contact: new Uint8Array([n]),
    id: new Uint8Array([n, n]),
  });
  const delivered: SendResult = { delivered: true, timedOut: false, attempts: 1 };

  function mockHandle(over: Partial<AccountMessaging> = {}): AccountMessaging {
    return {
      myContact: () => new Uint8Array(),
      myReceptionId: () => new Uint8Array(),
      exportIdentity: () => new Uint8Array(),
      connectToPartner: async () => {},
      acceptPartner: async () => {},
      isConnected: async () => true,
      resetConnection: async () => {},
      sendProposal: async () => delivered,
      sendAck: async () => delivered,
      onCoordination: async () => {},
      sendMemo: async () => delivered,
      onMemo: async () => {},
      sendMemoAck: async () => delivered,
      onMemoAck: async () => {},
      ...over,
    };
  }

  it('sends straight away to an already-connected cosigner', async () => {
    let connects = 0;
    const handle = mockHandle({
      isConnected: async () => true,
      connectToPartner: async () => {
        connects++;
      },
    });
    const [r] = await sendProposalToCosigners(handle, [target(1)], validPkg, { sleep: noSleep });
    expect(r.delivered).toBe(true);
    expect(r.attempts).toBe(1);
    expect(connects).toBe(0); // no handshake needed
  });

  it('opens a channel first, then sends once it comes up', async () => {
    let connects = 0;
    let checks = 0;
    const handle = mockHandle({
      isConnected: async () => checks++ >= 2, // false, false, then true
      connectToPartner: async () => {
        connects++;
      },
    });
    const [r] = await sendProposalToCosigners(handle, [target(1)], validPkg, { sleep: noSleep });
    expect(connects).toBe(1);
    expect(r.delivered).toBe(true);
  });

  it('reports a channel-timeout (and does not send) when the cosigner never confirms', async () => {
    let sent = 0;
    const handle = mockHandle({
      isConnected: async () => false,
      sendProposal: async () => {
        sent++;
        return delivered;
      },
    });
    const [r] = await sendProposalToCosigners(handle, [target(1)], validPkg, {
      channelTimeoutMs: 300,
      channelPollMs: 100,
      sleep: noSleep,
    });
    expect(r.delivered).toBe(false);
    expect(r.error).toMatch(/channel not established/i);
    expect(sent).toBe(0);
  });

  it('surfaces a non-delivered send without throwing', async () => {
    const handle = mockHandle({
      sendProposal: async () => ({ delivered: false, timedOut: true, attempts: 3 }),
    });
    const [r] = await sendProposalToCosigners(handle, [target(1)], validPkg, { sleep: noSleep });
    expect(r.delivered).toBe(false);
    expect(r.attempts).toBe(3);
    expect(r.error).toMatch(/not confirmed/i);
  });

  it('catches a thrown send error per target', async () => {
    const handle = mockHandle({
      sendProposal: async () => {
        throw new Error('mixnet exploded');
      },
    });
    const [r] = await sendProposalToCosigners(handle, [target(1)], validPkg, { sleep: noSleep });
    expect(r.delivered).toBe(false);
    expect(r.error).toBe('mixnet exploded');
  });

  it('fans out to every target and returns a result for each (mixed outcomes)', async () => {
    const handle = mockHandle({
      // target #2's id is [2,2] → fail its send; others deliver.
      sendProposal: async (id: Uint8Array) =>
        id[0] === 2 ? { delivered: false, timedOut: true } : delivered,
    });
    const results = await sendProposalToCosigners(
      handle,
      [target(1), target(2), target(3)],
      validPkg,
      { sleep: noSleep }
    );
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.delivered)).toEqual([true, false, true]);
  });
});

describe('sendMemoTo', () => {
  const target: CosignerTarget = { contact: new Uint8Array([7]), id: new Uint8Array([7, 7]) };
  const memo: ChatMemo = { kind: 'chat.memo', v: 1, id: 'm1', text: 'hi', sentAt: 1 };
  const ok: SendResult = { delivered: true, timedOut: false, attempts: 1 };
  const mk = (over: Partial<AccountMessaging> = {}): AccountMessaging => ({
    myContact: () => new Uint8Array(),
    myReceptionId: () => new Uint8Array(),
    exportIdentity: () => new Uint8Array(),
    connectToPartner: async () => {},
    acceptPartner: async () => {},
    isConnected: async () => true,
    resetConnection: async () => {},
    sendProposal: async () => ok,
    sendAck: async () => ok,
    onCoordination: async () => {},
    sendMemo: async () => ok,
    onMemo: async () => {},
    sendMemoAck: async () => ok,
    onMemoAck: async () => {},
    ...over,
  });

  it('sends to an already-connected partner', async () => {
    const r = await sendMemoTo(mk({ isConnected: async () => true }), target, memo, { sleep: noSleep });
    expect(r.delivered).toBe(true);
  });

  it('reports a channel-timeout without sending', async () => {
    let sent = 0;
    const handle = mk({
      isConnected: async () => false,
      sendMemo: async () => {
        sent++;
        return ok;
      },
    });
    const r = await sendMemoTo(handle, target, memo, {
      channelTimeoutMs: 100,
      channelPollMs: 50,
      sleep: noSleep,
    });
    expect(r.delivered).toBe(false);
    expect(sent).toBe(0);
  });

  it('surfaces a non-delivered send', async () => {
    const handle = mk({ sendMemo: async () => ({ delivered: false, timedOut: true }) });
    const r = await sendMemoTo(handle, target, memo, { sleep: noSleep });
    expect(r.delivered).toBe(false);
  });
});
