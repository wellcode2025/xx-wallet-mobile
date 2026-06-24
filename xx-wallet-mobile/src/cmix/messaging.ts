/**
 * cMix messaging service — composes the cMix session, e2e layer, and
 * coordination schema into one API the app calls.
 *
 * Lazily connects on first use (one cMix session + one e2e session per app
 * lifetime) and lets the UI: share our contact, connect to a partner (the
 * one-time handshake), send multisig proposal memos / acks with delivery
 * receipts, and receive coordination messages (always hash-gated on the way in).
 *
 * The same service underpins BOTH multisig coordination and general
 * wallet-to-wallet messaging — a "partner" is just another wallet's cMix
 * identity, with no multisig required.
 */
import { getCmixSession, type CmixSessionOptions } from './session';
import { createE2eSession, parseReceivedMessage, type E2eSession, type SendResult } from './e2e';
import type { AuthCallbacks } from './e2eApi';
import type { ConnectPhase } from './phases';
import {
  buildAckMessage,
  buildProposedMessage,
  parseCoordinationMessage,
  type CoordinationParseResult,
} from './coordinationMessage';
import type { BytesPackage } from '../utils/bytesPackage';
import { CHAT_MESSAGE_TYPE, buildChatMemo, parseChatMemo, type ChatMemo } from './chatMessage';

/** e2e message type used for multisig coordination memos (app-defined). */
export const COORDINATION_MESSAGE_TYPE = 2;

export interface MessagingHandle {
  /** Our shareable cMix contact — give to a partner so they can connect. */
  myContact(): Uint8Array;
  /** Our reception ID — partners address messages to this. */
  myReceptionId(): Uint8Array;
  /** Request an authenticated channel with a partner (the one-time handshake). */
  connectToPartner(partnerContact: Uint8Array): Promise<void>;
  /** Accept a partner's incoming channel request. */
  acceptPartner(partnerContact: Uint8Array): Promise<void>;
  /** Whether an authenticated channel with this partner exists. */
  isConnected(partnerId: Uint8Array): Promise<boolean>;
  /** Send a multisig proposal memo carrying the hash-gated package. */
  sendProposal(partnerId: Uint8Array, pkg: BytesPackage): Promise<SendResult>;
  /** Send an approve / reject ack referencing a proposal. */
  sendAck(
    partnerId: Uint8Array,
    action: 'approved' | 'rejected',
    multisigAddress: string,
    callHash: string
  ): Promise<SendResult>;
  /** Register a handler for incoming coordination messages from a sender. */
  onCoordination(senderId: Uint8Array, handler: (result: CoordinationParseResult) => void): Promise<void>;
  /** Send a free-text chat memo to a partner (1:1 messaging). */
  sendMemo(partnerId: Uint8Array, memo: ChatMemo): Promise<SendResult>;
  /** Register a handler for incoming chat memos from a sender (invalid memos dropped). */
  onMemo(senderId: Uint8Array, handler: (memo: ChatMemo) => void): Promise<void>;
}

export interface MessagingOptions {
  /** cMix session options (storage password, etc.) — supplied by the caller. */
  session: CmixSessionOptions;
  /** Auth-channel callbacks (e.g. auto-accept a known cosigner, or prompt the user). */
  authCallbacks?: Partial<AuthCallbacks>;
  /** Auto-confirm a channel Request iff this returns true for the requester's
   *  contact (a known cosigner). Forwarded to the e2e session. */
  autoConfirm?: (contact: Uint8Array) => boolean;
  /** Fired as each connect phase begins, so the UI can show real progress. */
  onPhase?: (phase: ConnectPhase) => void;
}

let handlePromise: Promise<MessagingHandle> | null = null;

/**
 * Connect the messaging service, building the cMix + e2e sessions on the first
 * call and returning the same handle thereafter. On failure the cache is
 * cleared so a later call retries cleanly.
 */
export function connectMessaging(opts: MessagingOptions): Promise<MessagingHandle> {
  if (!handlePromise) {
    handlePromise = build(opts).catch((err) => {
      handlePromise = null;
      throw err;
    });
  }
  return handlePromise;
}

/** Whether the messaging service has been connected (or is connecting). */
export function isMessagingConnected(): boolean {
  return handlePromise !== null;
}

async function build(opts: MessagingOptions): Promise<MessagingHandle> {
  const session = await getCmixSession({ ...opts.session, onPhase: opts.onPhase });
  opts.onPhase?.('finalizing');
  const e2e = await createE2eSession(session.cmix, {
    authCallbacks: opts.authCallbacks,
    autoConfirm: opts.autoConfirm,
  });
  return makeHandle(e2e);
}

function makeHandle(e2e: E2eSession): MessagingHandle {
  return {
    myContact: () => e2e.contact(),
    myReceptionId: () => e2e.receptionId(),
    connectToPartner: async (partnerContact) => {
      await e2e.requestChannel(partnerContact);
    },
    acceptPartner: async (partnerContact) => {
      await e2e.confirmChannel(partnerContact);
    },
    isConnected: (partnerId) => e2e.hasChannel(partnerId),
    sendProposal: (partnerId, pkg) =>
      e2e.send(partnerId, COORDINATION_MESSAGE_TYPE, buildProposedMessage(pkg)),
    sendAck: (partnerId, action, multisigAddress, callHash) =>
      e2e.send(partnerId, COORDINATION_MESSAGE_TYPE, buildAckMessage(action, multisigAddress, callHash)),
    onCoordination: (senderId, handler) =>
      e2e.onMessage(senderId, COORDINATION_MESSAGE_TYPE, (msg) =>
        handler(parseCoordinationMessage(msg.payload))
      ),
    sendMemo: (partnerId, memo) =>
      e2e.send(partnerId, CHAT_MESSAGE_TYPE, buildChatMemo(memo)),
    onMemo: (senderId, handler) =>
      e2e.onMessage(senderId, CHAT_MESSAGE_TYPE, (msg) => {
        const memo = parseChatMemo(msg.payload);
        if (memo) handler(memo);
      }),
  };
}

/**
 * Decode a raw incoming e2e message (the marshalled message bytes a listener
 * receives) into a validated coordination message: extract the application
 * payload, then validate + hash-gate it via the coordination schema. Pure;
 * exported for tests and any caller holding raw message bytes.
 */
export function decodeCoordinationPayload(rawMessage: Uint8Array): CoordinationParseResult {
  const { payload } = parseReceivedMessage(rawMessage);
  return parseCoordinationMessage(payload);
}

/**
 * The cacheable essence of an incoming 'proposed' memo — enough to drop into the
 * pending-bytes cache so the approval flow already has the (hash-verified) call
 * data. Returns null for acks and for parse failures (only a verified proposal
 * yields a result). Pure: the caller adds source + timestamp and decides whether
 * the multisig is one it actually knows.
 */
export interface IncomingProposal {
  multisigAddress: string;
  callHash: string;
  /** 0x hex call data, already hash-verified by parseCoordinationMessage. */
  callBytes: string;
  /** Who proposed it (from the verified package) — for the alert's display. */
  proposedBy: string;
}

export function incomingProposalFrom(result: CoordinationParseResult): IncomingProposal | null {
  if (!result.ok || result.message.action !== 'proposed') return null;
  const m = result.message;
  return {
    multisigAddress: m.multisigAddress,
    callHash: m.callHash,
    callBytes: m.package.callData,
    proposedBy: m.package.proposedBy,
  };
}

// ── Fan-out: deliver a proposal memo to a multisig's cosigners ──────────────

/** How long to wait for a freshly-requested auth channel to come up — the
 *  cosigner's auto-confirm round-trips through the mixnet (~seconds when both
 *  are online; never, if the cosigner is offline). */
const CHANNEL_TIMEOUT_MS = 60_000;
/** Poll cadence while waiting for a channel to establish. */
const CHANNEL_POLL_MS = 3_000;

/**
 * A cosigner device we can deliver a memo to: the stored contact (to open a
 * channel) plus its reception ID (to address sends). The ID is pre-extracted by
 * the caller (via getIDFromContact, which needs the wasm) so this layer stays
 * wasm-free and unit-testable.
 */
export interface CosignerTarget {
  contact: Uint8Array;
  id: Uint8Array;
}

/** Per-target outcome of a fan-out send. */
export interface CosignerSendResult {
  target: CosignerTarget;
  /** True iff the memo was receipt-confirmed delivered. */
  delivered: boolean;
  /** SendE2E attempts it took, when a send was actually attempted. */
  attempts?: number;
  /** A human-readable reason when not delivered (handshake timeout, send error). */
  error?: string;
}

export interface FanOutOptions {
  /** How long to wait for a freshly-requested channel to establish. */
  channelTimeoutMs?: number;
  /** Poll cadence while waiting for the channel. */
  channelPollMs?: number;
  /** Injected sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Poll `predicate` until it's true or the budget runs out. Attempt-based (not
 * wall-clock) so it's deterministic to test: checks once immediately, then up to
 * `ceil(timeoutMs / intervalMs)` more times with `intervalMs` between. Pure over
 * the injected `sleep`.
 */
export async function pollUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<boolean> {
  const polls = Math.max(0, Math.ceil(timeoutMs / intervalMs));
  if (await predicate()) return true;
  for (let i = 0; i < polls; i++) {
    await sleep(intervalMs);
    if (await predicate()) return true;
  }
  return false;
}

/**
 * Send a hash-gated proposal memo to every cosigner device IN PARALLEL.
 *
 * For each target: ensure an auth channel exists (lazy — request it, then wait
 * for the cosigner's auto-confirm to round-trip), then sendProposal (which
 * itself retries on non-delivery). Never throws — every target gets a
 * CosignerSendResult, so the UI can show per-cosigner delivery state and let the
 * user re-send only the ones that failed (e.g. a cosigner who was offline).
 */
export async function sendProposalToCosigners(
  handle: MessagingHandle,
  targets: CosignerTarget[],
  pkg: BytesPackage,
  opts: FanOutOptions = {}
): Promise<CosignerSendResult[]> {
  const channelTimeoutMs = opts.channelTimeoutMs ?? CHANNEL_TIMEOUT_MS;
  const channelPollMs = opts.channelPollMs ?? CHANNEL_POLL_MS;

  const sendOne = async (target: CosignerTarget): Promise<CosignerSendResult> => {
    try {
      if (!(await handle.isConnected(target.id))) {
        await handle.connectToPartner(target.contact);
        const up = await pollUntil(
          () => handle.isConnected(target.id),
          channelTimeoutMs,
          channelPollMs,
          opts.sleep
        );
        if (!up) {
          return {
            target,
            delivered: false,
            error: "Channel not established — the cosigner hasn't come online to confirm yet.",
          };
        }
      }
      const res = await handle.sendProposal(target.id, pkg);
      return {
        target,
        delivered: res.delivered,
        attempts: res.attempts,
        error: res.delivered ? undefined : 'Sent but delivery was not confirmed.',
      };
    } catch (e) {
      return { target, delivered: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  return Promise.all(targets.map(sendOne));
}
