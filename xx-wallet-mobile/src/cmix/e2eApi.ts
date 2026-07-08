/**
 * Typed bindings for the xxDK e2e + identity surface that `xxdk-wasm` does NOT
 * expose in its TypeScript types.
 *
 * The package's `XXDKUtils` type covers the cMix lifecycle and the DM/Channels
 * messaging stack, but not the older e2e auth-channel API (Login / Request /
 * Confirm / SendE2E / RegisterListener) or the identity + round-result helpers.
 * Those functions are present at runtime as raw wasm globals on `globalThis`
 * (and as untyped methods on the cMix object). We declare their shapes here —
 * taken directly from the xxdk-wasm Go bindings (wasm/{e2e,e2eAuth,e2eHandler,
 * cmix,delivery}.go) — and resolve them at call time. If a future xxdk-wasm
 * types these, this file can shrink.
 */
import type { CMix } from 'xxdk-wasm';

/**
 * Auth-channel callbacks passed to Login. Fire when an auth message from a
 * partner is processed: `Request` when they ask to connect, `Confirm` when they
 * accept our request, `Reset` when an existing relationship is reset.
 */
export interface AuthCallbacks {
  Request: (contact: Uint8Array, receptionId: Uint8Array, ephemeralId: number, roundId: number) => void;
  Confirm: (contact: Uint8Array, receptionId: Uint8Array, ephemeralId: number, roundId: number) => void;
  Reset: (contact: Uint8Array, receptionId: Uint8Array, ephemeralId: number, roundId: number) => void;
}

/** Listener registered for incoming e2e messages. `Hear` gets a marshalled message. */
export interface E2eListener {
  /** Receives the marshalled `bindings.Message` JSON bytes for each message. */
  Hear: (item: Uint8Array) => void;
  /** Identifies the listener (debug). */
  Name: () => string;
}

/** The E2e object returned by `Login`. Shapes from wasm/e2e*.go. */
export interface E2e {
  GetID(): number;
  /** Our reception ID — a partner sends to this. */
  GetReceptionID(): Uint8Array;
  /** Our shareable contact — give to a partner so they can request a channel. */
  GetContact(): Uint8Array;
  /** Request an authenticated channel with a partner. Resolves to the round ID. */
  Request(partnerContact: Uint8Array, factsListJson: Uint8Array): Promise<number>;
  /** Confirm a received channel request. Resolves to the round ID. */
  Confirm(partnerContact: Uint8Array): Promise<number>;
  /** Whether an authenticated channel with the partner exists. */
  HasAuthenticatedChannel(partnerId: Uint8Array): Promise<boolean>;
  /** Delete ALL traces of the relationship with a partner and send a reset
   *  request that builds a new one from scratch (a critical message — the
   *  client auto-resends it on round failure). Resolves to the round ID. */
  Reset(partnerContact: Uint8Array): Promise<number>;
  /** Resend a channel confirmation the partner never received. Only works
   *  while neither side has ratcheted. Resolves to the round ID. */
  ReplayConfirm(partnerContact: Uint8Array): Promise<number>;
  /** Delete stuck sent/received auth-request state for a partner (throws if
   *  there is none). Clears the state that can block a fresh Request/Reset. */
  DeleteRequest(partnerContact: Uint8Array): void;
  /** Send a payload to a partner. Resolves to the marshalled send report (carries the round list). */
  SendE2E(messageType: number, recipientId: Uint8Array, payload: Uint8Array, e2eParams: Uint8Array): Promise<Uint8Array>;
  /** Register a handler for messages of `messageType` from `senderId`. */
  RegisterListener(senderId: Uint8Array, messageType: number, listener: E2eListener): Promise<void>;
}

/** Callback for `WaitForRoundResult` — the delivery receipt. */
export interface RoundResultCallback {
  /**
   * @param delivered    true iff ALL of the message's rounds completed successfully.
   * @param timedOut     true if monitoring timed out before a result.
   * @param roundResults marshalled per-round results (unused by us).
   */
  EventCallback: (delivered: boolean, timedOut: boolean, roundResults: Uint8Array) => void;
}

/** cMix methods present at runtime but missing from xxdk-wasm's typed `CMix`. */
export interface CMixE2eExtensions {
  /** Generate a fresh e2e reception identity. */
  MakeReceptionIdentity(): Promise<Uint8Array>;
  /** Watch the rounds in a send report and report whether they completed. */
  WaitForRoundResult(report: Uint8Array, callback: RoundResultCallback, timeoutMs: number): void;
}

/** The untyped e2e + identity globals the wasm registers on `globalThis`. */
export interface E2eGlobals {
  Login(cmixId: number, callbacks: AuthCallbacks, identity: Uint8Array, e2eParams: Uint8Array): E2e;
  GetDefaultE2EParams(): Uint8Array;
  StoreReceptionIdentity(key: string, identity: Uint8Array, cmixId: number): void;
  LoadReceptionIdentity(key: string, cmixId: number): Uint8Array;
}

const GLOBAL_FN_NAMES = ['Login', 'GetDefaultE2EParams', 'StoreReceptionIdentity', 'LoadReceptionIdentity'] as const;

/**
 * Resolve the untyped e2e/identity globals from `globalThis`. Throws if any are
 * missing, which means the wasm has not finished initialising (callers should
 * always `loadXXDK()` / build the session first).
 */
export function getE2eGlobals(): E2eGlobals {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const name of GLOBAL_FN_NAMES) {
    if (typeof g[name] !== 'function') {
      throw new Error(
        `xxDK e2e binding "${name}" is not available on globalThis — the cMix wasm is not initialised.`
      );
    }
  }
  return g as unknown as E2eGlobals;
}

/**
 * View a typed `CMix` as also carrying its untyped e2e extensions
 * (`MakeReceptionIdentity`, `WaitForRoundResult`). These exist on the runtime
 * object but not in the package's `CMix` type.
 */
export function asE2eCmix(cmix: CMix): CMix & CMixE2eExtensions {
  return cmix as CMix & CMixE2eExtensions;
}

/**
 * Extract the canonical reception ID (33-byte id.ID) from a marshalled cMix
 * contact, via the xxDK `GetIDFromContact` global.
 *
 * The SAME identity marshals to DIFFERENT contact bytes depending on what's
 * attached: an inbound auth-channel request carries an ownership proof (and the
 * request's facts) that a plain `GetContact()` does not — verified live, the
 * request form was 651 B vs 611 B for the same identity. The reception ID is
 * invariant across those forms, so it's the right key for recognising a known
 * partner. Resolved on demand (not via getE2eGlobals) so a build without this
 * binding degrades to "can't identify" rather than breaking all of e2e. Throws
 * if the wasm isn't initialised.
 */
export function getIDFromContact(contact: Uint8Array): Uint8Array {
  const fn = (globalThis as unknown as Record<string, unknown>).GetIDFromContact;
  if (typeof fn !== 'function') {
    throw new Error(
      'xxDK binding "GetIDFromContact" is not available on globalThis — the cMix wasm is not initialised.'
    );
  }
  return (fn as (c: Uint8Array) => Uint8Array)(contact);
}
