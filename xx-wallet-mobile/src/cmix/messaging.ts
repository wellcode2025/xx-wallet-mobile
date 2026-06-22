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
