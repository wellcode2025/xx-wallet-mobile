/**
 * Tests for the pure helpers in the e2e layer. The session orchestration
 * (Login / handshake / SendE2E / receipts) is integration-level and not
 * unit-tested, per the project's "pure logic only" rule.
 */
import { describe, expect, it } from 'vitest';
import {
  attachToSlot,
  base64ToBytes,
  hearIntoSlot,
  listenerKey,
  parseReceivedMessage,
  withSendRetry,
  type ListenerSlot,
  type ReceivedMessage,
} from './e2e';

const bytesToText = (b: Uint8Array) => new TextDecoder().decode(b);
const noSleep = () => Promise.resolve();

describe('listener slots (pre-registered receive buffering)', () => {
  const msg = (n: number): ReceivedMessage => ({ payload: new Uint8Array([n]), raw: null });
  const freshSlot = (): ListenerSlot => ({ queue: [], handler: null });

  it('queues messages heard before a handler attaches, then replays them in order', () => {
    const slot = freshSlot();
    hearIntoSlot(slot, msg(1));
    hearIntoSlot(slot, msg(2));
    const seen: number[] = [];
    attachToSlot(slot, (m) => seen.push(m.payload[0]));
    expect(seen).toEqual([1, 2]);
    expect(slot.queue).toHaveLength(0); // drained, not re-replayable
  });

  it('delivers directly once a handler is attached', () => {
    const slot = freshSlot();
    const seen: number[] = [];
    attachToSlot(slot, (m) => seen.push(m.payload[0]));
    hearIntoSlot(slot, msg(7));
    expect(seen).toEqual([7]);
    expect(slot.queue).toHaveLength(0);
  });

  it('re-attaching replaces the handler (no duplicate delivery)', () => {
    const slot = freshSlot();
    const first: number[] = [];
    const second: number[] = [];
    attachToSlot(slot, (m) => first.push(m.payload[0]));
    attachToSlot(slot, (m) => second.push(m.payload[0]));
    hearIntoSlot(slot, msg(9));
    expect(first).toEqual([]);
    expect(second).toEqual([9]);
  });

  it('listenerKey is stable per (sender, type) and distinguishes both parts', () => {
    const a = new Uint8Array([0, 1, 255]);
    const b = new Uint8Array([0, 1, 254]);
    expect(listenerKey(a, 3)).toBe(listenerKey(a, 3));
    expect(listenerKey(a, 3)).not.toBe(listenerKey(a, 4));
    expect(listenerKey(a, 3)).not.toBe(listenerKey(b, 3));
    expect(listenerKey(a, 3)).toBe('0001ff:3');
  });
});

describe('base64ToBytes', () => {
  it('decodes base64 to the original bytes', () => {
    // "hi" => "aGk="
    expect(Array.from(base64ToBytes('aGk='))).toEqual([104, 105]);
  });

  it('decodes the empty string to empty bytes', () => {
    expect(base64ToBytes('').length).toBe(0);
  });

  it('round-trips arbitrary text through btoa', () => {
    const text = '{"kind":"multisig.coordination","callHash":"0xabc"}';
    expect(bytesToText(base64ToBytes(btoa(text)))).toBe(text);
  });
});

describe('parseReceivedMessage', () => {
  it('extracts the base64 Payload from a marshalled message', () => {
    const payloadText = '{"kind":"memo","callHash":"0xabc123"}';
    const message = new TextEncoder().encode(
      JSON.stringify({ MessageType: 2, Payload: btoa(payloadText), Sender: 'abc' })
    );
    const out = parseReceivedMessage(message);
    expect(bytesToText(out.payload)).toBe(payloadText);
    expect((out.raw as { MessageType: number }).MessageType).toBe(2);
  });

  it('accepts a lowercase `payload` field too', () => {
    const message = new TextEncoder().encode(JSON.stringify({ payload: btoa('hi') }));
    expect(bytesToText(parseReceivedMessage(message).payload)).toBe('hi');
  });

  it('returns empty payload when there is no Payload field', () => {
    const message = new TextEncoder().encode(JSON.stringify({ MessageType: 2 }));
    expect(parseReceivedMessage(message).payload.length).toBe(0);
  });

  it('falls back to the raw bytes (and null raw) on non-JSON input', () => {
    const item = new TextEncoder().encode('not json {');
    const out = parseReceivedMessage(item);
    expect(out.payload).toBe(item);
    expect(out.raw).toBeNull();
  });
});

describe('withSendRetry', () => {
  it('returns after the first attempt when delivered', async () => {
    let calls = 0;
    const r = await withSendRetry(
      async () => {
        calls++;
        return { delivered: true, timedOut: false };
      },
      { maxAttempts: 3, backoffMs: 0, sleep: noSleep }
    );
    expect(calls).toBe(1);
    expect(r.delivered).toBe(true);
    expect(r.attempts).toBe(1);
  });

  it('resends on a non-delivery and reports the attempt it landed on', async () => {
    let calls = 0;
    const r = await withSendRetry(
      async () => {
        calls++;
        return { delivered: calls === 3, timedOut: calls !== 3 };
      },
      { maxAttempts: 5, backoffMs: 0, sleep: noSleep }
    );
    expect(calls).toBe(3);
    expect(r.delivered).toBe(true);
    expect(r.attempts).toBe(3);
  });

  it('gives up after maxAttempts and returns the last undelivered receipt', async () => {
    let calls = 0;
    const r = await withSendRetry(
      async () => {
        calls++;
        return { delivered: false, timedOut: true };
      },
      { maxAttempts: 3, backoffMs: 0, sleep: noSleep }
    );
    expect(calls).toBe(3);
    expect(r.delivered).toBe(false);
    expect(r.attempts).toBe(3);
  });

  it('backs off between attempts but not after the last', async () => {
    let sleeps = 0;
    await withSendRetry(async () => ({ delivered: false, timedOut: false }), {
      maxAttempts: 3,
      backoffMs: 5,
      sleep: async () => {
        sleeps++;
      },
    });
    expect(sleeps).toBe(2); // between 1→2 and 2→3, never after the final attempt
  });
});
