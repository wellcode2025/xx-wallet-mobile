/**
 * Local decoding and verification of Substrate call bytes.
 *
 * **This file embodies the wallet's central security value.** When call
 * bytes arrive out-of-band for a pending multisig (via paste, file, QR,
 * or the eventual notification service), we hash them locally and verify
 * against the on-chain `callHash`. Only then do we decode the bytes via
 * the chain's metadata and render a description from the decoded call
 * itself. The depositor never gets to be a trusted narrator of "what
 * these bytes mean" — the bytes mean what they decode to, full stop.
 *
 * The single hard line: if `verifyCallHash` returns false,
 * the wallet must NOT render any description and must NOT enable the
 * approve button. There is no "approximately correct" rendering — either
 * the bytes hash to the on-chain hash, or they don't.
 *
 * Decoder coverage is narrow by design: balances.transferKeepAlive
 * gets a friendly humanized description (covers 100% of foundation usage
 * observed live on chain); multisig and utility wrappers are decoded
 * recursively; everything else falls back to the truthful literal
 * `section.method(arg=val,...)` form. The friendly coverage can be broadened
 * later; the recursive structure is already complete.
 */

import type { ApiPromise } from '@polkadot/api';
import type { Call } from '@polkadot/types/interfaces';
import { hexToU8a, isHex, u8aToHex } from '@polkadot/util';
import { blake2AsHex } from '@polkadot/util-crypto';
import { formatBalance } from './format';
import { shortenAddress } from './address';
import { XX_SYMBOL } from '../api/constants';

/**
 * Structured representation of a decoded call. Consumers render `friendly`
 * if non-null, falling back to `literal` for unrecognized call types.
 *
 * The recursive `innerCalls` array carries the same structure for
 * wrappers — when this call is a multisig.asMulti or utility.batch, each
 * inner call is its own DecodedCall and can be displayed nested.
 */
export interface DecodedCall {
  /** Pallet name. e.g. "balances", "multisig", "utility". */
  section: string;
  /** Method within the pallet. e.g. "transferKeepAlive". */
  method: string;
  /** Fully qualified for compact display: "section.method". */
  fq: string;
  /** Always-truthful representation: `section.method(arg=val,...)`. Safe
   *  to render for any call type even if unrecognized. */
  literal: string;
  /** Friendly humanized one-liner if we recognize this call type. Null
   *  means "no friendly form, render `literal`". The wallet must NEVER
   *  invent a friendly description for an unknown call — that would
   *  reintroduce the depositor-as-narrator failure mode through the
   *  decoder's back door. */
  friendly: string | null;
  /** Structured per-argument view for consumers that want detail rows. */
  args: Record<string, unknown>;
  /** Recursively decoded inner calls (for multisig wrappers and utility
   *  batches). Empty for leaf calls. */
  innerCalls: DecodedCall[];
}

// ---------- Hash verification ----------

/**
 * Verify that call bytes hash to the expected on-chain call hash.
 *
 * Substrate's `pallet_multisig` stores `T::Hashing::hash(call)` as the
 * call hash, where `Hashing` is blake2_256 on xx network (and most
 * Substrate chains). So the verification is `blake2_256(bytes) == hash`.
 *
 * Returns false (rather than throwing) on malformed input. The check is
 * meant to be a guard, not a validator; throwing would force every
 * caller to wrap in try/catch and one would forget.
 *
 * Crypto pre-init: blake2 requires cryptoWaitReady to have resolved.
 * The wallet awaits this at app startup (in the keyring init).
 */
export function verifyCallHash(
  bytes: string | Uint8Array,
  expectedHash: string
): boolean {
  let u8: Uint8Array;
  if (typeof bytes === 'string') {
    if (!isHex(bytes)) return false;
    try {
      u8 = hexToU8a(bytes);
    } catch {
      return false;
    }
  } else {
    u8 = bytes;
  }
  if (u8.length === 0) return false;

  let computed: string;
  try {
    computed = blake2AsHex(u8, 256);
  } catch {
    return false;
  }

  // Normalise both sides to lowercase 0x-prefixed hex before comparing.
  const norm = (h: string): string => {
    if (!h || typeof h !== 'string') return '';
    const lower = h.toLowerCase().trim();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
  };
  return norm(computed) === norm(expectedHash);
}

// ---------- Decoding ----------

/**
 * Decode raw call bytes via the chain's runtime metadata.
 *
 * Throws on malformed bytes (the chain's createType will throw if the
 * bytes don't decode against the runtime's type registry). Callers
 * should display the resulting error to the user — a decode failure is
 * itself useful information ("these bytes don't decode against the
 * current chain runtime"), and we deliberately don't swallow it.
 *
 * The `api` argument must be a connected ApiPromise — the registry
 * needs the runtime metadata to know how to interpret the bytes.
 */
export function decodeCall(
  bytes: string | Uint8Array,
  api: ApiPromise
): DecodedCall {
  const u8 = typeof bytes === 'string' ? hexToU8a(bytes) : bytes;
  const call = api.registry.createType('Call', u8);
  return decodeCallFromGenericCall(call, api);
}

/**
 * Recursively decode a `Call` object that's already been parsed by the
 * registry. Used by `decodeCall` for the top-level entry point and by
 * itself for inner calls inside multisig and utility wrappers.
 */
function decodeCallFromGenericCall(call: Call, api: ApiPromise): DecodedCall {
  const section = call.section;
  const method = call.method;
  const fq = `${section}.${method}`;

  // Build a name-keyed args map using the call's metadata for argument names.
  const argDefs = call.meta?.args ?? [];
  const argsByName: Record<string, unknown> = {};
  for (let i = 0; i < call.args.length; i++) {
    const name = argDefs[i]?.name?.toString() ?? `arg${i}`;
    argsByName[name] = call.args[i];
  }

  const innerCalls = recursivelyDecodeInner(call, api);

  // Build the always-truthful literal first; it's the fallback rendering.
  const literal = `${fq}(${formatArgsLiteral(argsByName)})`;

  // Then attempt friendly humanization for recognized call types.
  const friendly = friendlyDescription(fq, argsByName, innerCalls);

  return {
    section,
    method,
    fq,
    literal,
    friendly,
    args: argsByName,
    innerCalls,
  };
}

/**
 * Find inner-call arguments inside known wrapper types and recursively
 * decode them. Returns an empty array for non-wrapper calls.
 */
function recursivelyDecodeInner(call: Call, api: ApiPromise): DecodedCall[] {
  const fq = `${call.section}.${call.method}`;

  // multisig.asMulti / approveAsMulti / asMultiThreshold1 — the inner call
  // is in the `call` arg position. approveAsMulti only carries a hash
  // (not the full inner call), so it has no decodable inner.
  if (
    fq === 'multisig.asMulti' ||
    fq === 'multisig.asMultiThreshold1'
  ) {
    const innerArg = call.args.find(
      (_, i) => call.meta?.args?.[i]?.name?.toString() === 'call'
    );
    if (innerArg) {
      try {
        return [decodeCallFromGenericCall(innerArg as unknown as Call, api)];
      } catch {
        return [];
      }
    }
    return [];
  }

  // utility.batch / batchAll / forceBatch — the calls live in the `calls`
  // arg, an array of Calls.
  if (
    fq === 'utility.batch' ||
    fq === 'utility.batchAll' ||
    fq === 'utility.forceBatch'
  ) {
    const callsArg = call.args.find(
      (_, i) => call.meta?.args?.[i]?.name?.toString() === 'calls'
    );
    if (callsArg && Array.isArray(callsArg)) {
      const inner: DecodedCall[] = [];
      for (const c of callsArg) {
        try {
          inner.push(decodeCallFromGenericCall(c as Call, api));
        } catch {
          // Skip individual undecodable items rather than failing the
          // whole batch — partial visibility is better than none.
        }
      }
      return inner;
    }
    return [];
  }

  return [];
}

/**
 * Render a friendly one-line description for recognized call types.
 *
 * Scope: balances.transferKeepAlive (and the defensive variants),
 * plus recursive descriptions for multisig and batch wrappers. Anything
 * else returns null so the caller falls back to `literal`.
 *
 * Coverage can be broadened later. Until then the truthful-fallback rule
 * keeps unrecognized calls from being silently described as something
 * they aren't.
 */
function friendlyDescription(
  fq: string,
  args: Record<string, unknown>,
  innerCalls: DecodedCall[]
): string | null {
  switch (fq) {
    case 'balances.transferKeepAlive':
    case 'balances.transferAllowDeath':
    case 'balances.transfer': {
      const dest = formatDestAddress(args.dest);
      const value = args.value;
      let valueStr = '?';
      if (value != null) {
        try {
          // value is typically a Compact<Balance> — stringify gives raw planck
          valueStr = formatBalance(String(value));
        } catch {
          valueStr = String(value);
        }
      }
      return `Send ${valueStr} ${XX_SYMBOL} to ${dest}`;
    }

    case 'multisig.asMulti':
    case 'multisig.asMultiThreshold1':
      if (innerCalls.length > 0) {
        const inner = innerCalls[0];
        return `[Multisig wrapper] ${inner.friendly ?? inner.literal}`;
      }
      return '[Multisig wrapper] (inner call not decodable)';

    case 'multisig.approveAsMulti':
      // approve_as_multi only carries the call hash, never the call body.
      // Showing this from raw bytes would be a misuse — the user pastes
      // bytes EXPECTING to see the inner action, and approveAsMulti doesn't
      // contain one. Surface the limitation truthfully.
      return '[Multisig approval — no call body in this variant; the call hash only]';

    case 'utility.batch':
    case 'utility.batchAll':
    case 'utility.forceBatch':
      if (innerCalls.length > 0) {
        const lines = innerCalls.map(
          (c, i) => `  ${i + 1}. ${c.friendly ?? c.literal}`
        );
        return `Batch of ${innerCalls.length}:\n${lines.join('\n')}`;
      }
      return null;

    default:
      // Unknown call type. Returning null here is load-bearing for the
      // trust model — the wallet must not invent a friendly description
      // for something it doesn't recognize. The caller renders `literal`
      // instead, which is at least truthful.
      return null;
  }
}

// ---------- Argument rendering helpers ----------

function formatArgsLiteral(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${k}=${formatLiteralValue(v)}`)
    .join(', ');
}

function formatLiteralValue(v: unknown): string {
  if (v == null) return 'null';
  // Polkadot Codec types implement toJSON / toString sensibly
  try {
    const obj = v as { toJSON?: () => unknown; toString: () => string };
    if (typeof obj.toJSON === 'function') {
      const j = obj.toJSON();
      if (typeof j === 'string') return shortenForLiteral(j);
      if (typeof j === 'number' || typeof j === 'bigint') return String(j);
      if (j && typeof j === 'object') {
        return shortenForLiteral(JSON.stringify(j));
      }
    }
    return shortenForLiteral(obj.toString());
  } catch {
    return shortenForLiteral(String(v));
  }
}

function shortenForLiteral(s: string, max = 60): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max / 2)}…${s.slice(-max / 2)}`;
}

/**
 * Pull a human-renderable address out of a destination argument.
 *
 * Substrate's MultiAddress can be `{Id: "6..."}`, a plain string, or
 * `{Index: N}` / `{Raw: "0x..."}` for less common variants. We handle
 * Id and plain string, returning a shortened SS58 — address-book
 * nickname substitution is handled by the rendering layer.
 */
function formatDestAddress(dest: unknown): string {
  if (dest == null) return '?';
  // Codec object — try toJSON
  try {
    const obj = dest as { toJSON?: () => unknown; toString?: () => string };
    if (typeof obj.toJSON === 'function') {
      const j = obj.toJSON();
      if (typeof j === 'string') return shortenAddress(j);
      if (j && typeof j === 'object') {
        const o = j as Record<string, unknown>;
        const id = o.id ?? o.Id;
        if (typeof id === 'string') return shortenAddress(id);
      }
    }
    if (typeof obj.toString === 'function') {
      const s = obj.toString();
      if (s.startsWith('6')) return shortenAddress(s);
    }
  } catch {
    /* fall through */
  }
  return '(unrecognized destination form)';
}

// ---------- Safe-decode wrapper (preimages) ----------

/**
 * The canonical failure copy. Used everywhere a decode is attempted on
 * potentially-orphaned bytes (preimages noted against an older runtime,
 * for instance) and we need to render the failure rather than crash.
 *
 * **This string is load-bearing for the trust model.** When decode fails
 * the UI must show this exact wording — never invent a softer-sounding
 * fallback like "Couldn't read this proposal" that downplays the failure.
 * The web wallet uses this exact phrasing on its Preimages page; staying
 * verbatim means xx users see consistent UX regardless of which wallet
 * they happen to be looking at.
 */
export const DECODE_FAILURE_LABEL =
  'Unable to decode preimage bytes into a valid Call';

/**
 * Discriminated-union result of a non-throwing decode attempt.
 *
 * `safeDecodeCall` wraps `decodeCall` for surfaces (preimages page,
 * governance referendum detail) that need to render *something* even
 * when the bytes don't decode. Multisig approval still uses the
 * throwing `decodeCall` directly — there, a decode failure is a
 * security event that must propagate and block the approval, not
 * become a soft-failed UI state.
 */
export type SafeDecodeResult =
  | { ok: true; decoded: DecodedCall }
  | { ok: false; error: string; rawHex: string };

/**
 * Attempt to decode call bytes; return a discriminated result instead of
 * throwing. Use this on read-only surfaces (preimage list, referendum
 * detail) where a decode failure should render the canonical
 * "Unable to decode" banner rather than crash the screen.
 *
 * The `rawHex` field carries the canonical hex form so the UI can show
 * the bytes (and let users copy them out for external inspection)
 * alongside the failure message. The `error` is the upstream Error's
 * message, useful for debug-mode rendering but never the user-facing
 * label — that's always `DECODE_FAILURE_LABEL`.
 */
export function safeDecodeCall(
  bytes: string | Uint8Array,
  api: ApiPromise
): SafeDecodeResult {
  try {
    const decoded = decodeCall(bytes, api);
    return { ok: true, decoded };
  } catch (e) {
    const rawHex = normalizeCallBytes(bytes);
    const err = e as Error;
    return {
      ok: false,
      error: err?.message ?? String(e),
      rawHex,
    };
  }
}

// ---------- Display extraction helpers ----------

/**
 * Structured summary for a transfer call, suitable for visually-prominent
 * rendering. Returns null if the decoded call isn't a transfer variant we
 * recognize.
 *
 * Why we extract the amount + recipient as separate fields rather than
 * letting the UI parse the friendly string: prominence. The single most
 * common attack vector against approval flows is the extra-zero scam
 * (1,000,000 vs 10,000,000 read in a hurry). The wallet's job is to
 * make those visually unmistakable, which means rendering the amount
 * with strong typography in its own visual region — not embedded in a
 * sentence the eye can skim.
 *
 * The amount is returned formatted with thousand-separators (e.g.
 * "1,000,000") so even at a glance the number of zeros is countable.
 * The raw planck value is also returned in case the consumer wants to
 * defensively re-verify against the call args.
 */
export interface TransferSummary {
  /** Human-formatted amount with thousand separators, e.g. "1,500,000". */
  formattedAmount: string;
  /** Raw planck value (smallest chain unit), as a string for safe BigInt
   *  reasoning by consumers. */
  rawPlanck: string;
  /** The on-chain currency symbol — currently always XX. */
  symbol: string;
  /** Recipient SS58 address (full form). */
  recipient: string;
}

/**
 * Try to extract a structured transfer summary from a decoded call.
 * Returns null for any call type that isn't a balances transfer variant
 * (or whose args we couldn't parse defensively).
 */
export function extractTransferSummary(
  decoded: DecodedCall
): TransferSummary | null {
  if (
    decoded.fq !== 'balances.transferKeepAlive' &&
    decoded.fq !== 'balances.transferAllowDeath' &&
    decoded.fq !== 'balances.transfer'
  ) {
    return null;
  }
  const dest = decoded.args.dest;
  const value = decoded.args.value;
  if (dest == null || value == null) return null;

  // Resolve recipient. Reuse the same MultiAddress handling used by the
  // friendly-description path (Id variant or plain string).
  let recipient: string | null = null;
  try {
    const obj = dest as { toJSON?: () => unknown; toString?: () => string };
    if (typeof obj.toJSON === 'function') {
      const j = obj.toJSON();
      if (typeof j === 'string') recipient = j;
      else if (j && typeof j === 'object') {
        const o = j as Record<string, unknown>;
        const id = o.id ?? o.Id;
        if (typeof id === 'string') recipient = id;
      }
    }
    if (!recipient && typeof obj.toString === 'function') {
      const s = obj.toString();
      if (s.startsWith('6')) recipient = s;
    }
  } catch {
    /* fall through */
  }
  if (!recipient) return null;

  // Resolve raw planck. value may be a Compact<Balance> or already a
  // string/number; defensive on both.
  let rawPlanck: string | null = null;
  try {
    const v = value as { toString: () => string };
    rawPlanck = String(v);
  } catch {
    rawPlanck = null;
  }
  if (!rawPlanck || !/^\d+$/.test(rawPlanck)) return null;

  // formatBalance already groups by default and trims trailing zeros.
  // We pass a high decimal cap so we don't truncate dust-level precision
  // — for very small transfers, every digit matters.
  const formattedAmount = formatBalance(rawPlanck, {
    decimals: 9,
    trim: true,
    grouping: true,
  });

  return {
    formattedAmount,
    rawPlanck,
    symbol: XX_SYMBOL,
    recipient,
  };
}

/**
 * Normalize call bytes to canonical 0x-prefixed lowercase hex. Used when
 * caching bytes locally — keeping a single canonical form simplifies
 * lookup keys and equality checks.
 */
export function normalizeCallBytes(bytes: string | Uint8Array): string {
  if (typeof bytes !== 'string') {
    return u8aToHex(bytes);
  }
  if (!bytes.startsWith('0x') && !bytes.startsWith('0X')) {
    return `0x${bytes.toLowerCase()}`;
  }
  return bytes.toLowerCase();
}
