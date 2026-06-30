/**
 * The wallet's e2e messaging layer, built on the cMix session.
 *
 * After a one-time authenticated-channel handshake with a partner (Request →
 * Confirm), a durable, forward-secret channel exists and either side can send
 * indefinitely with no re-handshake. This is the foundation for BOTH multisig
 * coordination memos (between cosigners) and general wallet-to-wallet messaging
 * (any two wallets) — the partner is just another wallet's cMix identity.
 *
 * RELIABLE DELIVERY IS BUILT IN. Every send is verified with WaitForRoundResult
 * on the send report's rounds — the receipt check that, when skipped, makes
 * messages silently drop (the Haven failure). A caller can see `delivered` and
 * retry on failure rather than assuming-sent.
 *
 * The auth-channel message is a TRANSPORT, never an instruction: the multisig
 * use case feeds the received payload through the existing bytes-package hash
 * gate (§6.4/§7.3), exactly as a pasted/QR'd package is.
 */
import type { CMix } from 'xxdk-wasm';
import { asE2eCmix, getE2eGlobals, type AuthCallbacks, type E2e, type E2eListener } from './e2eApi';
import { ensureReceptionIdentity } from './identity';

/** Empty fact list for a channel request (we don't attach UD facts). */
const EMPTY_FACTS = new TextEncoder().encode('[]');
/** How long to wait for a round-result receipt before reporting a timeout. */
const RECEIPT_TIMEOUT_MS = 30_000;
/**
 * Max SendE2E attempts before giving up. cMix delivery is probabilistic — the
 * e2e spike saw a receive leg time out on roughly half its runs before landing
 * cleanly — so a receipt that never confirms warrants a resend. Memos are
 * hash-gated and idempotent at the receiver, so a duplicate from a
 * false-negative receipt is harmless.
 */
const MAX_SEND_ATTEMPTS = 3;
/** Backoff between resend attempts. */
const SEND_RETRY_BACKOFF_MS = 2_000;
const LISTENER_NAME = 'xx-wallet-e2e';

/** Result of a send, derived from the round-result receipt. */
export interface SendResult {
  /** True iff all of the message's rounds completed (the message went out). */
  delivered: boolean;
  /** True if the receipt monitoring timed out without a definitive result. */
  timedOut: boolean;
  /** How many SendE2E attempts it took (1 = first-try). Set by the retrying
   *  sender; undefined on a raw single receipt. */
  attempts?: number;
}

/** A decoded incoming e2e message. */
export interface ReceivedMessage {
  /** The application payload (decoded from the message's base64 `Payload`). */
  payload: Uint8Array;
  /** The full parsed message object, or null if it didn't parse as JSON. */
  raw: unknown;
}

export interface E2eSession {
  /** The underlying E2e object, for advanced use. */
  readonly e2e: E2e;
  /** Our shareable contact — give to a partner so they can request a channel. */
  contact(): Uint8Array;
  /** Our reception ID — a partner sends to this. */
  receptionId(): Uint8Array;
  /** Our marshalled reception identity — the portable credential to back up /
   *  export (the bytes Login was given). Safe only behind the messaging
   *  passphrase; never share it raw. */
  identityBytes(): Uint8Array;
  /** Request an authenticated channel with a partner (the one-time handshake). */
  requestChannel(partnerContact: Uint8Array, facts?: Uint8Array): Promise<number>;
  /** Confirm a partner's incoming channel request. */
  confirmChannel(partnerContact: Uint8Array): Promise<number>;
  /** Whether an authenticated channel with this partner exists. */
  hasChannel(partnerId: Uint8Array): Promise<boolean>;
  /** Send a payload to a partner, verified with a delivery receipt. */
  send(partnerId: Uint8Array, messageType: number, payload: Uint8Array): Promise<SendResult>;
  /** Register a handler for incoming messages of `messageType` from `senderId`. */
  onMessage(senderId: Uint8Array, messageType: number, handler: (msg: ReceivedMessage) => void): Promise<void>;
}

/** Options for creating the e2e session. */
export interface CreateE2eOptions {
  /** Observe raw auth-channel handshake events (Request / Confirm / Reset). */
  authCallbacks?: Partial<AuthCallbacks>;
  /**
   * Auto-confirm an incoming channel Request iff this returns true for the
   * requester's contact bytes (e.g. a known cosigner already in the registry).
   * Requests from anyone else are ignored — no channel forms, no exposure to
   * strangers. The channel is otherwise lazy: a cosigner's Request typically
   * arrives on their first send to us.
   */
  autoConfirm?: (contact: Uint8Array) => boolean;
  /**
   * Restore: marshalled reception identity bytes (from a decrypted backup) to
   * adopt as THIS device's identity instead of loading/minting one. Makes the
   * device the same messaging party as the backup's origin.
   */
  importIdentity?: Uint8Array;
}

/**
 * Create the e2e messaging session for ONE account on top of a live, healthy
 * cMix session. Logs in with that account's persisted reception identity (or, on
 * restore, the imported one), so it survives restarts. One cMix client can host
 * several of these at once (one per account) — see the messaging layer.
 */
export async function createE2eSession(
  cmix: CMix,
  account: string,
  opts: CreateE2eOptions = {}
): Promise<E2eSession> {
  const globals = getE2eGlobals();
  const identity = await ensureReceptionIdentity(cmix, account, opts.importIdentity);
  const e2eParams = globals.GetDefaultE2EParams();

  // The Request handler needs e2e.Confirm, but `e2e` doesn't exist until Login
  // returns — capture it via a deferred ref the callback closes over.
  let e2eRef: E2e | null = null;
  const callbacks: AuthCallbacks = {
    Request: (contact, receptionId, ephemeralId, roundId) => {
      if (opts.autoConfirm?.(contact) && e2eRef) {
        e2eRef.Confirm(contact).catch(() => {
          /* confirm failed (offline/blip) — the partner can retry */
        });
      }
      opts.authCallbacks?.Request?.(contact, receptionId, ephemeralId, roundId);
    },
    Confirm: (contact, receptionId, ephemeralId, roundId) =>
      opts.authCallbacks?.Confirm?.(contact, receptionId, ephemeralId, roundId),
    Reset: (contact, receptionId, ephemeralId, roundId) =>
      opts.authCallbacks?.Reset?.(contact, receptionId, ephemeralId, roundId),
  };

  const e2e = globals.Login(cmix.GetID(), callbacks, identity, e2eParams);
  e2eRef = e2e;

  return {
    e2e,
    contact: () => e2e.GetContact(),
    receptionId: () => e2e.GetReceptionID(),
    identityBytes: () => identity,
    requestChannel: (partnerContact, facts = EMPTY_FACTS) => e2e.Request(partnerContact, facts),
    confirmChannel: (partnerContact) => e2e.Confirm(partnerContact),
    hasChannel: (partnerId) => e2e.HasAuthenticatedChannel(partnerId),
    send: (partnerId, messageType, payload) =>
      sendWithReceipt(cmix, e2e, partnerId, messageType, payload, e2eParams),
    onMessage: async (senderId, messageType, handler) => {
      const listener: E2eListener = {
        Hear: (item) => handler(parseReceivedMessage(item)),
        Name: () => LISTENER_NAME,
      };
      await e2e.RegisterListener(senderId, messageType, listener);
    },
  };
}

/**
 * SendE2E + verify the rounds actually completed (the receipt Haven skipped),
 * RESENDING on a non-delivery up to MAX_SEND_ATTEMPTS — cMix delivery is
 * probabilistic, so one unconfirmed receipt isn't a real failure. Resolves with
 * the final receipt (annotated with `attempts`) so callers can still surface a
 * hard, all-attempts-failed result.
 */
async function sendWithReceipt(
  cmix: CMix,
  e2e: E2e,
  partnerId: Uint8Array,
  messageType: number,
  payload: Uint8Array,
  e2eParams: Uint8Array
): Promise<SendResult> {
  return withSendRetry(
    async () => {
      const report = await e2e.SendE2E(messageType, partnerId, payload, e2eParams);
      return waitForRoundResult(cmix, report, RECEIPT_TIMEOUT_MS);
    },
    { maxAttempts: MAX_SEND_ATTEMPTS, backoffMs: SEND_RETRY_BACKOFF_MS }
  );
}

/**
 * Resend until a delivery receipt confirms the message landed, up to
 * `maxAttempts`. cMix delivery is probabilistic, so a receipt reporting
 * not-delivered (or a timeout) warrants a resend; a confirmed `delivered`
 * returns immediately. Never throws for a non-delivery — returns the final
 * receipt annotated with the attempt count and lets the caller decide what a
 * still-undelivered memo means. Pure over the injected `sendOnce` (and `sleep`),
 * so it's unit-testable without the mixnet.
 */
export async function withSendRetry(
  sendOnce: (attempt: number) => Promise<SendResult>,
  opts: { maxAttempts: number; backoffMs: number; sleep?: (ms: number) => Promise<void> }
): Promise<SendResult> {
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: SendResult = { delivered: false, timedOut: false, attempts: 0 };
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const result = await sendOnce(attempt);
    last = { ...result, attempts: attempt };
    if (result.delivered) return last;
    if (attempt < opts.maxAttempts) await sleep(opts.backoffMs);
  }
  return last;
}

/** Wrap WaitForRoundResult (whose result arrives via a callback) in a promise. */
function waitForRoundResult(cmix: CMix, report: Uint8Array, timeoutMs: number): Promise<SendResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SendResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    try {
      asE2eCmix(cmix).WaitForRoundResult(
        report,
        { EventCallback: (delivered, timedOut) => finish({ delivered, timedOut }) },
        timeoutMs
      );
    } catch {
      // Bad report or unavailable API — report as not delivered rather than throw.
      finish({ delivered: false, timedOut: false });
    }
    // Safety net: if the callback never fires, treat it as a timeout.
    setTimeout(() => finish({ delivered: false, timedOut: true }), timeoutMs + 5000);
  });
}

/**
 * Parse a received e2e message — the marshalled `bindings.Message` JSON whose
 * `Payload` is the base64 application bytes. Falls back to the raw bytes if it
 * doesn't parse. Pure; exported for tests.
 */
export function parseReceivedMessage(item: Uint8Array): ReceivedMessage {
  try {
    const raw = JSON.parse(new TextDecoder().decode(item)) as Record<string, unknown>;
    const payloadB64 = raw.Payload ?? raw.payload;
    const payload = typeof payloadB64 === 'string' ? base64ToBytes(payloadB64) : new Uint8Array();
    return { payload, raw };
  } catch {
    return { payload: item, raw: null };
  }
}

/** Decode standard base64 to bytes. Pure; exported for tests. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
