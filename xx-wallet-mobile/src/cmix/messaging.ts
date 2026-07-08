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
import type { CMix } from 'xxdk-wasm';
import { getCmixSession, type CmixSessionOptions } from './session';
import { createE2eSession, parseReceivedMessage, type E2eSession, type SendResult } from './e2e';
import { ensureReceptionIdentity } from './identity';
import type { AuthCallbacks } from './e2eApi';
import type { ConnectPhase } from './phases';
import {
  buildAckMessage,
  buildProposedMessage,
  parseCoordinationMessage,
  type CoordinationParseResult,
} from './coordinationMessage';
import type { BytesPackage } from '../utils/bytesPackage';
import {
  CHAT_MESSAGE_TYPE,
  CHAT_ACK_TYPE,
  buildChatMemo,
  parseChatMemo,
  buildChatAck,
  parseChatAck,
  type ChatMemo,
  type ChatAck,
} from './chatMessage';

/** e2e message type used for multisig coordination memos (app-defined). */
export const COORDINATION_MESSAGE_TYPE = 2;

/**
 * Messaging operations for ONE of the user's accounts (one cMix identity). All
 * the send/receive/share methods are scoped to that account's identity — its
 * contact, its reception ID, its channels. The user has one of these per account
 * they message as; the parent MessagingHandle hands them out.
 */
export interface AccountMessaging {
  /** Our shareable cMix contact — give to a partner so they can connect. */
  myContact(): Uint8Array;
  /** Our reception ID — partners address messages to this. */
  myReceptionId(): Uint8Array;
  /** Our marshalled reception identity, for an encrypted backup/export (NEVER
   *  shared raw — it's the private credential, gated behind the passphrase). */
  exportIdentity(): Uint8Array;
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
  /** Send a delivery ack for a received memo back to its sender (distinct from
   *  sendAck, which is the multisig approve/reject ack). */
  sendMemoAck(partnerId: Uint8Array, ackId: string): Promise<SendResult>;
  /** Register a handler for incoming memo-delivery acks from a sender (invalid acks dropped). */
  onMemoAck(senderId: Uint8Array, handler: (ack: ChatAck) => void): Promise<void>;
}

/**
 * The device's messaging service: one cMix client hosting one identity PER
 * account. `forAccount` lazily logs in (and memoizes) an account's identity and
 * returns its AccountMessaging — every send/receive is explicit about which
 * account it's as.
 */
export interface MessagingHandle {
  /** Messaging scoped to one of the user's accounts (lazily logs its identity in). */
  forAccount(account: string): Promise<AccountMessaging>;
  /** Accounts whose identity is currently logged in this session. */
  loadedAccounts(): string[];
}

export interface MessagingOptions {
  /** cMix session options (storage password, etc.) — supplied by the caller. */
  session: CmixSessionOptions;
  /** The account whose identity is logged in eagerly + backs the primary-account
   *  convenience methods (typically the active account). */
  primaryAccount: string;
  /**
   * Additional accounts whose identities are logged in BEFORE the network
   * follower starts (typically every enrolled identity account). Logging in
   * registers an identity's decryption fingerprints — and the follower's first
   * polls retrieve any messages buffered while the app was closed, which are
   * dropped unrecoverably if the fingerprints aren't registered yet (the
   * cold-resume race, diagnosed 2026-07-06). Failures on non-primary accounts
   * don't block go-online; they fall back to the lazy forAccount path.
   */
  eagerAccounts?: string[];
  /** Auth-channel callbacks (e.g. auto-accept a known cosigner, or prompt the user). */
  authCallbacks?: Partial<AuthCallbacks>;
  /** Auto-confirm a channel Request iff this returns true for the requester's
   *  contact (a known cosigner). Forwarded to each account's e2e session. */
  autoConfirm?: (contact: Uint8Array) => boolean;
  /** Fired as each connect phase begins, so the UI can show real progress. */
  onPhase?: (phase: ConnectPhase) => void;
  /** Restore: persist these decrypted-backup identities (one per account) into
   *  the EKV before logging in, so each account is reachable as its backed-up
   *  identity. */
  importIdentities?: { account: string; identity: Uint8Array }[];
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

/**
 * The accounts to log in before the follower starts: the primary first, then
 * every other known identity account, deduped. Pure; exported for tests.
 */
export function eagerLoginList(primary: string, others: string[] = []): string[] {
  return [...new Set([primary, ...others])];
}

async function build(opts: MessagingOptions): Promise<MessagingHandle> {
  // One identity per account, logged in + memoized on the single client
  // (one cMix follower hosts them all — proven in the multi-identity spike).
  const loaded = new Map<string, Promise<AccountMessaging>>();
  let cmixRef: CMix | null = null;
  const create = (account: string): Promise<AccountMessaging> => {
    let p = loaded.get(account);
    if (!p) {
      const cmix = cmixRef;
      if (!cmix) throw new Error('cMix session not ready');
      p = createE2eSession(cmix, account, {
        authCallbacks: opts.authCallbacks,
        autoConfirm: opts.autoConfirm,
      }).then(makeAccountMessaging);
      loaded.set(account, p);
    }
    return p;
  };

  // COLD-RESUME ORDERING (the offline-delivery fix, 2026-07-06). The follower
  // recovers messages buffered while the app was closed within seconds of
  // starting; a message whose account hasn't logged in yet (no decryption
  // fingerprints registered) is dropped and its round marked checked — lost for
  // good. So every known identity is logged in BEFORE the follower starts, via
  // the session's pre-follower hook, instead of lazily afterwards.
  const session = await getCmixSession({
    ...opts.session,
    onPhase: opts.onPhase,
    beforeFollower: async (cmix) => {
      cmixRef = cmix;
      // Restore: persist each backed-up identity under its account BEFORE any
      // Login, so the sessions below load the restored identity, not a fresh one.
      for (const { account, identity } of opts.importIdentities ?? []) {
        await ensureReceptionIdentity(cmix, account, identity);
      }
      for (const account of eagerLoginList(opts.primaryAccount, opts.eagerAccounts)) {
        try {
          await create(account);
        } catch (err) {
          // The primary account failing is fatal (matches the old behavior);
          // any other identity failing shouldn't block messaging as a whole —
          // un-memoize it so forAccount can retry lazily.
          if (account === opts.primaryAccount) throw err;
          loaded.delete(account);
          console.warn(`[cmix] pre-follower login failed for ${account}; will retry lazily`, err);
        }
      }
    },
  });
  cmixRef = session.cmix;
  opts.onPhase?.('finalizing');

  // If the session already existed (a retry after an earlier failure past the
  // session stage), the pre-follower hook never ran — fall back to the old
  // post-follower path. Idempotent: ensure + create are both memoized.
  for (const { account, identity } of opts.importIdentities ?? []) {
    await ensureReceptionIdentity(session.cmix, account, identity);
  }
  await create(opts.primaryAccount);

  return {
    forAccount: create,
    loadedAccounts: () => [...loaded.keys()],
  };
}

function makeAccountMessaging(e2e: E2eSession): AccountMessaging {
  return {
    myContact: () => e2e.contact(),
    myReceptionId: () => e2e.receptionId(),
    exportIdentity: () => e2e.identityBytes(),
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
    sendMemoAck: (partnerId, ackId) =>
      e2e.send(partnerId, CHAT_ACK_TYPE, buildChatAck(ackId)),
    onMemoAck: (senderId, handler) =>
      e2e.onMessage(senderId, CHAT_ACK_TYPE, (msg) => {
        const ack = parseChatAck(msg.payload);
        if (ack) handler(ack);
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
 * Ensure an auth channel to a target exists: if not already connected, request
 * one and wait (poll) for the partner's auto-confirm to round-trip. Returns
 * whether the channel came up. Shared by the proposal fan-out and 1:1 chat.
 */
async function ensureChannel(
  handle: AccountMessaging,
  target: CosignerTarget,
  timeoutMs: number,
  pollMs: number,
  sleep?: (ms: number) => Promise<void>
): Promise<boolean> {
  if (await handle.isConnected(target.id)) return true;
  await handle.connectToPartner(target.contact);
  return pollUntil(() => handle.isConnected(target.id), timeoutMs, pollMs, sleep);
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
  handle: AccountMessaging,
  targets: CosignerTarget[],
  pkg: BytesPackage,
  opts: FanOutOptions = {}
): Promise<CosignerSendResult[]> {
  const channelTimeoutMs = opts.channelTimeoutMs ?? CHANNEL_TIMEOUT_MS;
  const channelPollMs = opts.channelPollMs ?? CHANNEL_POLL_MS;

  const sendOne = async (target: CosignerTarget): Promise<CosignerSendResult> => {
    try {
      const up = await ensureChannel(handle, target, channelTimeoutMs, channelPollMs, opts.sleep);
      if (!up) {
        return {
          target,
          delivered: false,
          error: "Channel not established — the cosigner hasn't come online to confirm yet.",
        };
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

/** Outcome of sending a single 1:1 chat memo. */
export interface MemoSendResult {
  /** True iff the memo was receipt-confirmed delivered. */
  delivered: boolean;
  attempts?: number;
  /** A human-readable reason when not delivered. */
  error?: string;
}

/**
 * Send a single 1:1 chat memo to a partner: ensure the channel, then sendMemo
 * (which retries on non-delivery). Never throws — returns a MemoSendResult the
 * chat UI uses to mark the message delivered / failed and offer a re-send.
 */
export async function sendMemoTo(
  handle: AccountMessaging,
  target: CosignerTarget,
  memo: ChatMemo,
  opts: FanOutOptions = {}
): Promise<MemoSendResult> {
  const channelTimeoutMs = opts.channelTimeoutMs ?? CHANNEL_TIMEOUT_MS;
  const channelPollMs = opts.channelPollMs ?? CHANNEL_POLL_MS;
  try {
    const up = await ensureChannel(handle, target, channelTimeoutMs, channelPollMs, opts.sleep);
    if (!up) {
      return { delivered: false, error: "Channel not established — they haven't come online yet." };
    }
    const res = await handle.sendMemo(target.id, memo);
    return {
      delivered: res.delivered,
      attempts: res.attempts,
      error: res.delivered ? undefined : 'Sent but delivery was not confirmed.',
    };
  } catch (e) {
    return { delivered: false, error: e instanceof Error ? e.message : String(e) };
  }
}
