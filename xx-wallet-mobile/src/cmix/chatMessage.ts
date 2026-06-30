/**
 * 1:1 chat memo — the wire envelope a plain text message travels in over e2e.
 *
 * Distinct from the multisig COORDINATION message type: this is free-text
 * person-to-person messaging (a "coordination conversation area"), not a
 * hash-gated proposal. No instruction semantics — it's just text the recipient
 * displays; nothing here drives a signing decision.
 *
 * cMix keeps no permanent server-side history (gateways hold an undelivered
 * message ~21 days for offline pickup, then purge), so the conversation log is
 * the client's responsibility — see store/cmixChat. This module is only the
 * pure wire format: build + parse + validate.
 */

const KIND = 'chat.memo';
const ACK_KIND = 'chat.ack';
const VERSION = 1;

/** e2e messageType for 1:1 chat memos — distinct from coordination (2). */
export const CHAT_MESSAGE_TYPE = 3;

/** e2e messageType for chat delivery acks — distinct from memos (3). The
 *  recipient auto-sends one on receipt so the sender's checkmark means "they got
 *  it," not just "it entered a completed round." */
export const CHAT_ACK_TYPE = 4;

/** Max chars in a single memo. Caps storage + keeps within mixnet message size;
 *  a malformed/hostile oversize payload is rejected at parse rather than stored. */
export const MAX_MEMO_CHARS = 2000;

export interface ChatMemo {
  kind: typeof KIND;
  v: typeof VERSION;
  /** Client-generated unique id — dedups duplicates from a delivery retry and
   *  ties an outgoing message to its receipt. */
  id: string;
  text: string;
  /** Sender's clock at send time (ms). Display-only; never trusted for ordering
   *  against local time (a peer's clock can be wrong/adversarial). */
  sentAt: number;
}

/** Create a fresh memo for `text` (random id + current clock). */
export function newChatMemo(text: string): ChatMemo {
  return { kind: KIND, v: VERSION, id: randomId(), text, sentAt: Date.now() };
}

/** Serialize a memo to the e2e payload bytes. */
export function buildChatMemo(memo: ChatMemo): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ kind: KIND, v: VERSION, id: memo.id, text: memo.text, sentAt: memo.sentAt })
  );
}

/**
 * Parse + validate a received memo payload. Returns null on anything malformed,
 * unknown, empty, or over the size cap — a bad memo is dropped, never surfaced.
 */
export function parseChatMemo(input: Uint8Array | string | unknown): ChatMemo | null {
  let raw: unknown = input;
  if (input instanceof Uint8Array) {
    try {
      raw = JSON.parse(new TextDecoder().decode(input));
    } catch {
      return null;
    }
  } else if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (o.kind !== KIND) return null;
  if (typeof o.v !== 'number' || o.v > VERSION) return null;
  if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 128) return null;
  if (typeof o.text !== 'string' || o.text.length === 0 || o.text.length > MAX_MEMO_CHARS) {
    return null;
  }
  if (typeof o.sentAt !== 'number' || !Number.isFinite(o.sentAt)) return null;

  return { kind: KIND, v: VERSION, id: o.id, text: o.text, sentAt: o.sentAt };
}

/** A delivery ack referencing the memo id it confirms. */
export interface ChatAck {
  kind: typeof ACK_KIND;
  v: typeof VERSION;
  /** The id of the memo being acknowledged. */
  ackId: string;
}

/** Serialize a delivery ack to the e2e payload bytes. */
export function buildChatAck(ackId: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ kind: ACK_KIND, v: VERSION, ackId }));
}

/**
 * Parse + validate a received ack payload. Returns null on anything malformed,
 * unknown, or newer-versioned — a bad ack is dropped, never acted on.
 */
export function parseChatAck(input: Uint8Array | string | unknown): ChatAck | null {
  let raw: unknown = input;
  if (input instanceof Uint8Array) {
    try {
      raw = JSON.parse(new TextDecoder().decode(input));
    } catch {
      return null;
    }
  } else if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (o.kind !== ACK_KIND) return null;
  if (typeof o.v !== 'number' || o.v > VERSION) return null;
  if (typeof o.ackId !== 'string' || o.ackId.length === 0 || o.ackId.length > 128) return null;

  return { kind: ACK_KIND, v: VERSION, ackId: o.ackId };
}

function randomId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
