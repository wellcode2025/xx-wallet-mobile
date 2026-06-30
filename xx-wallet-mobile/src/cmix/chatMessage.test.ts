/**
 * Tests for the 1:1 chat memo wire format — build/parse round-trip + the
 * validation that drops malformed, oversize, or non-memo payloads.
 */
import { describe, expect, it } from 'vitest';
import {
  buildChatMemo,
  newChatMemo,
  parseChatMemo,
  buildChatAck,
  parseChatAck,
  MAX_MEMO_CHARS,
  type ChatMemo,
} from './chatMessage';

describe('newChatMemo', () => {
  it('stamps kind/version + a unique id and the text', () => {
    const a = newChatMemo('hello');
    const b = newChatMemo('hello');
    expect(a.kind).toBe('chat.memo');
    expect(a.v).toBe(1);
    expect(a.text).toBe('hello');
    expect(typeof a.sentAt).toBe('number');
    expect(a.id).not.toBe(b.id); // ids are random per memo
  });
});

describe('buildChatMemo / parseChatMemo', () => {
  it('round-trips a memo through bytes', () => {
    const memo = newChatMemo('gm, ready to sign?');
    const out = parseChatMemo(buildChatMemo(memo));
    expect(out).toEqual(memo);
  });

  it('rejects non-JSON bytes', () => {
    expect(parseChatMemo(new TextEncoder().encode('not json {'))).toBeNull();
  });

  it('rejects a non-memo kind', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ kind: 'something.else', v: 1, id: 'x', text: 'hi', sentAt: 1 })
    );
    expect(parseChatMemo(bytes)).toBeNull();
  });

  it('rejects empty text and missing fields', () => {
    const base = { kind: 'chat.memo', v: 1, id: 'abc', text: 'hi', sentAt: 1 };
    expect(parseChatMemo(JSON.stringify({ ...base, text: '' }))).toBeNull();
    expect(parseChatMemo(JSON.stringify({ ...base, id: '' }))).toBeNull();
    expect(parseChatMemo(JSON.stringify({ ...base, sentAt: 'nope' }))).toBeNull();
    expect(parseChatMemo(JSON.stringify({ kind: 'chat.memo', v: 1 }))).toBeNull();
  });

  it('rejects text over the size cap', () => {
    const memo: ChatMemo = { kind: 'chat.memo', v: 1, id: 'abc', text: 'x'.repeat(MAX_MEMO_CHARS + 1), sentAt: 1 };
    expect(parseChatMemo(buildChatMemo(memo))).toBeNull();
  });

  it('rejects a future version', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ kind: 'chat.memo', v: 99, id: 'abc', text: 'hi', sentAt: 1 })
    );
    expect(parseChatMemo(bytes)).toBeNull();
  });
});

describe('buildChatAck / parseChatAck', () => {
  it('round-trips an ack through bytes', () => {
    const out = parseChatAck(buildChatAck('memo-id-123'));
    expect(out).toEqual({ kind: 'chat.ack', v: 1, ackId: 'memo-id-123' });
  });

  it('rejects non-JSON, the wrong kind, and a missing/empty ackId', () => {
    expect(parseChatAck(new TextEncoder().encode('nope {'))).toBeNull();
    expect(parseChatAck(JSON.stringify({ kind: 'chat.memo', v: 1, ackId: 'x' }))).toBeNull();
    expect(parseChatAck(JSON.stringify({ kind: 'chat.ack', v: 1, ackId: '' }))).toBeNull();
    expect(parseChatAck(JSON.stringify({ kind: 'chat.ack', v: 1 }))).toBeNull();
  });

  it('rejects a future version', () => {
    expect(parseChatAck(JSON.stringify({ kind: 'chat.ack', v: 99, ackId: 'x' }))).toBeNull();
  });

  // A memo and an ack must never parse as each other (they ride distinct e2e types).
  it('does not cross-parse with memos', () => {
    expect(parseChatMemo(buildChatAck('x'))).toBeNull();
    expect(parseChatAck(buildChatMemo(newChatMemo('hi')))).toBeNull();
  });
});
