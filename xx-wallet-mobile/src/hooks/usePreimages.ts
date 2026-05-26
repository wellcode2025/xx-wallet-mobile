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
import type { BN } from '@polkadot/util';
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
 * codec. Defensive across the two known shapes (older `len` as plain
 * number on `Requested`, newer Option<u32> shape).
 */
function readStatus(statusCodec: any): {
  kind: PreimageStatusKind;
  count: number;
  length: number;
  depositor: string;
  deposit: BN | null;
} | null {
  const asNum = (raw: any): number => {
    if (raw == null) return 0;
    if (typeof raw === 'number') return raw;
    if (typeof raw.toNumber === 'function') return raw.toNumber();
    const n = Number(raw.toString?.() ?? raw);
    return Number.isFinite(n) ? n : 0;
  };
  try {
    if (statusCodec.isUnrequested) {
      const inner = statusCodec.asUnrequested;
      const [accCodec, balCodec] = readDeposit(inner.deposit);
      return {
        kind: 'unrequested',
        count: 0,
        length: asNum(inner.len),
        depositor: accCodec?.toString?.() ?? '',
        deposit: balCodec?.toBn?.() ?? null,
      };
    }
    if (statusCodec.isRequested) {
      const inner = statusCodec.asRequested;
      const [accCodec, balCodec] = readDeposit(inner.deposit ?? inner.maybeTicket);
      return {
        kind: 'requested',
        count: asNum(inner.count),
        length: asNum(inner.len ?? inner.maybeLen),
        depositor: accCodec?.toString?.() ?? '',
        deposit: balCodec?.toBn?.() ?? null,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Unwrap a deposit tuple from either a raw `(AccountId, Balance)` tuple
 * or an `Option<(AccountId, Balance)>`. Returns [null, null] on absence.
 */
function readDeposit(d: any): [any, any] {
  if (d == null) return [null, null];
  try {
    if (typeof d.isSome === 'boolean') {
      if (!d.isSome) return [null, null];
      const inner = d.unwrap();
      return [inner[0], inner[1]];
    }
    return [d[0], d[1]];
  } catch {
    return [null, null];
  }
}
