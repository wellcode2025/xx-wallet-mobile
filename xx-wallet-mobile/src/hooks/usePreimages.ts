/**
 * usePreimages — list of every preimage stored on chain, decoded where
 * possible and surfaced honestly where not.
 *
 * Phase 4 Slice 2. Two-step fetch:
 *
 *   1. preimage.statusFor.entries() — yields (hash, RequestStatus) for
 *      every noted preimage. Both Unrequested and Requested variants
 *      carry depositor + len; Requested also carries a count of how
 *      many extrinsics have called requestPreimage on this hash.
 *
 *   2. preimage.preimageFor([hash, len]) — fetches the raw bytes. Then
 *      safeDecodeCall(bytes, api) returns a discriminated result. The
 *      caller renders the decoded form on success or the canonical
 *      "Unable to decode preimage bytes into a valid Call" banner on
 *      failure — this is the §6.4 trust-model invariant in production.
 *
 * Sort: by length descending. Larger preimages are generally the most
 * interesting (recursive batches, complex scheduler calls) and tend to
 * also be the ones most likely to fail decode under runtime drift, so
 * the failure cases bubble to the top where they get attention.
 *
 * Identity prefetch: the depositor SS58 gets fed through
 * resolveIdentitiesBatch so the row label can render names instead of
 * raw addresses by render time.
 */

import { useEffect, useState } from 'react';
import { BN } from '@polkadot/util';
import { xxApi } from '@/api';
import { safeDecodeCall, type SafeDecodeResult } from '@/utils';
import { resolveIdentitiesBatch } from '@/governance';

export type PreimageStatusKind = 'unrequested' | 'requested';

export interface PreimageEntry {
  /** Hex hash including 0x prefix. */
  hash: string;
  /** Status kind — Requested means at least one extrinsic has requested decode. */
  kind: PreimageStatusKind;
  /** Number of outstanding requests (Requested only; 0 for Unrequested). */
  count: number;
  /** Bytes length according to the chain. */
  length: number;
  /** Depositor SS58. */
  depositor: string;
  /** Deposit amount in planck. */
  deposit: BN | null;
  /** Decode outcome — ok with section.method tree, or fail with rawHex + error. */
  decodeResult: SafeDecodeResult | null;
}

interface UsePreimagesResult {
  preimages: PreimageEntry[];
  isLoading: boolean;
  error: Error | null;
}

export function usePreimages(): UsePreimagesResult {
  const [state, setState] = useState<UsePreimagesResult>({
    preimages: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true, error: null }));

    (async () => {
      try {
        const api = await xxApi.getApi();
        if (cancelled) return;
        // statusFor.entries() returns Vec<(hash-key, RequestStatus)>.
        const statusQuery: any = api.query.preimage?.statusFor;
        if (!statusQuery?.entries) {
          setState({ preimages: [], isLoading: false, error: null });
          return;
        }
        const entries: any[] = await statusQuery.entries();
        if (cancelled) return;

        // Decode each status into a typed shape we can render off of.
        type Decoded = {
          hash: string;
          kind: PreimageStatusKind;
          count: number;
          length: number;
          depositor: string;
          deposit: BN | null;
        };
        const decoded: Decoded[] = [];
        for (const [key, statusCodec] of entries) {
          try {
            const hash = (key.args[0] as { toHex: () => string }).toHex();
            const info = readStatus(statusCodec);
            if (info) decoded.push({ hash, ...info });
          } catch {
            /* skip undecodable entry */
          }
        }

        // Fetch bytes in parallel and run safeDecodeCall on each.
        const decodeResults: (SafeDecodeResult | null)[] = await Promise.all(
          decoded.map(async (d) => {
            try {
              const bytesOpt: any = await api.query.preimage.preimageFor([
                d.hash,
                d.length,
              ]);
              if (!bytesOpt?.isSome) return null;
              const raw = bytesOpt.unwrap();
              return safeDecodeCall(raw.toU8a ? raw.toU8a(true) : raw, api);
            } catch (e) {
              return {
                ok: false,
                error: (e as Error)?.message ?? String(e),
                rawHex: '',
              } as SafeDecodeResult;
            }
          })
        );
        if (cancelled) return;

        // Compose final list, sorted by length descending.
        const preimages: PreimageEntry[] = decoded
          .map((d, i) => ({
            hash: d.hash,
            kind: d.kind,
            count: d.count,
            length: d.length,
            depositor: d.depositor,
            deposit: d.deposit,
            decodeResult: decodeResults[i],
          }))
          .sort((a, b) => b.length - a.length);

        // Prefetch depositor identities (fire-and-forget).
        const ids = new Set<string>();
        for (const p of preimages) ids.add(p.depositor);
        if (ids.size > 0) {
          resolveIdentitiesBatch([...ids]).catch(() => {
            /* identity is enrichment, not load-bearing */
          });
        }

        setState({ preimages, isLoading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err as Error,
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * Pull depositor + length + (where applicable) count from a RequestStatus
 * codec.
 *
 * Parses `statusCodec.toJSON()` directly rather than the codec-level
 * `.isUnrequested` / `.asUnrequested` accessors. The Phase 4 spike
 * confirmed the JSON shape:
 *
 *   {"unrequested": {"deposit": [accountId, balance], "len": 199}}
 *   {"requested":   {"deposit": [accountId, balance], "count": 1, "len": 3896}}
 *
 * Empirically the runtime's codec accessor names DON'T match what
 * polkadot-codec would auto-derive (Slice 2 shipped with that bug —
 * `.isUnrequested` returned false for all 8 entries and the screen
 * showed an empty list). The JSON keys are stable and lowercase,
 * which makes JSON-based parsing the more portable choice.
 */
/**
 * Exported for testing — see usePreimages.test.ts. Don't import
 * from outside the hook in production code.
 */
export function readStatus(statusCodec: any): {
  kind: PreimageStatusKind;
  count: number;
  length: number;
  depositor: string;
  deposit: BN | null;
} | null {
  let json: any;
  try {
    json = statusCodec?.toJSON?.();
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;

  if ('unrequested' in json) {
    const inner = (json as any).unrequested ?? {};
    const [depositor, deposit] = parseDeposit(inner.deposit);
    return {
      kind: 'unrequested',
      count: 0,
      length: asNum(inner.len),
      depositor,
      deposit,
    };
  }
  if ('requested' in json) {
    const inner = (json as any).requested ?? {};
    // Some runtimes use `deposit` (a tuple), others `maybeTicket` (an
    // Option<tuple>). toJSON renders Option as either null or the
    // inner value, so both paths handle to the same parseDeposit call.
    const [depositor, deposit] = parseDeposit(inner.deposit ?? inner.maybeTicket);
    return {
      kind: 'requested',
      count: asNum(inner.count),
      length: asNum(inner.len ?? inner.maybeLen),
      depositor,
      deposit,
    };
  }
  return null;
}

/**
 * Coerce a JSON-encoded number-like value to a JS number.
 *
 * polkadot-js's toJSON returns small integers as JS numbers and big
 * integers as 0x-prefixed hex strings. For preimage lengths the value
 * is always small (a u32) so JS-number form is overwhelmingly common,
 * but we handle the hex case too in case a runtime ever emits one.
 */
function asNum(raw: any): number {
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    if (raw.startsWith('0x')) {
      const n = parseInt(raw, 16);
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Parse the JSON-encoded deposit tuple `[AccountId, Balance]` into a
 * `[depositor, BN]` pair. Returns `['', null]` for absent (Option::None
 * renders as JSON null) or for unrecognised shapes.
 *
 * Balances may come back as JS numbers (small values) or as
 * `0x...`-prefixed hex strings (large values that exceed safe integer
 * range). BN handles both.
 */
function parseDeposit(d: any): [string, BN | null] {
  if (!d) return ['', null];
  if (!Array.isArray(d)) return ['', null];
  const depositor = typeof d[0] === 'string' ? d[0] : String(d[0] ?? '');
  let deposit: BN | null = null;
  const bal = d[1];
  try {
    if (typeof bal === 'number') {
      deposit = new BN(bal);
    } else if (typeof bal === 'string') {
      deposit = bal.startsWith('0x')
        ? new BN(bal.slice(2), 16)
        : new BN(bal, 10);
    }
  } catch {
    deposit = null;
  }
  return [depositor, deposit];
}
