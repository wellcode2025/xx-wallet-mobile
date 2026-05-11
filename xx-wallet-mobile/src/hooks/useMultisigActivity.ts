/**
 * useMultisigActivity — fetch the historical activity log for a multisig.
 *
 * Returns the list of `MultisigExecuted` events at this multisig address,
 * each enriched with the corresponding extrinsic's `nested_calls` (the
 * indexer's pre-decoded representation of the inner call that was executed).
 *
 * Why this is useful for the read-only multisig view: it lets us show
 * "what has this multisig actually done?" — a timeline of executed actions
 * (e.g., "Send 2M XX to 6Wwj…PojL") rather than just a list of transfers
 * (which doesn't capture the multisig context — a transfer signed via
 * as_multi looks identical to a regular transfer in the `transfer` table).
 *
 * For slice 1 (read-only view), we only surface MultisigExecuted events —
 * the things the multisig has actually done. NewMultisig/MultisigApproval
 * events (proposals created or partially approved) are part of the
 * lifecycle but are slice 2 territory (Pending actions list).
 *
 * Indexer schema and query patterns confirmed against `indexer.xx.network`
 * by the Phase 2a spike (`scripts/spikes/multisig-spike-address.mjs`).
 *
 * Degradation: if the indexer is unreachable, returns an error and an empty
 * list. The wallet itself remains operable (signing path doesn't depend on
 * this) — only the historical view is affected.
 */

import { useEffect, useState } from 'react';

const INDEXER_URL = 'https://indexer.xx.network/v1/graphql';
const PAGE_SIZE = 25;

export interface MultisigActivityItem {
  /** Stable id for React keys: `${blockNumber}-${extrinsicIndex}` */
  id: string;
  blockNumber: number;
  extrinsicIndex: number;
  /** Unix timestamp in milliseconds (the indexer stores ms). */
  timestamp: number;
  /** The cosigner who submitted the final approval (signed the extrinsic). */
  signer: string;
  /** The on-chain call hash for this proposal. */
  callHash: string;
  /** Did the inner call execute successfully? */
  success: boolean;
  /** Extrinsic-level base fee in raw planck. May be null on very old
   *  extrinsics where the indexer didn't record it. */
  fee: string | null;
  /**
   * The indexer's pre-decoded recursive call structure. We type this
   * loosely (`unknown`) on purpose — the shape varies with the runtime,
   * and a sloppy type would mislead consumers more than `unknown` does.
   * Consumers (the multisig detail screen) parse defensively at use site.
   *
   * Empirically, for a multisig.asMulti executing balances.transferKeepAlive,
   * the structure is roughly:
   *   [
   *     { module: "multisig", call: "asMulti", args: "[...]", ...,
   *       depth: 0 },
   *     { module: "balances", call: "transferKeepAlive",
   *       args: '[{"id":"6...."},20000000000000]', depth: 1 }
   *   ]
   */
  nestedCalls: unknown;
}

/**
 * The indexer's GraphQL shape for a Multisig "executed" event. We pull
 * the event row for filtering, then join to the extrinsic row to get the
 * pre-decoded call data.
 *
 * Two-step query rather than a single nested one because the event/extrinsic
 * relationship in this Hasura schema doesn't have a foreign-key relationship
 * we can traverse directly — they share (block_number, phase) but the join
 * isn't first-class.
 */
const EVENTS_QUERY = `
  query MultisigEvents($addrLike: String!, $limit: Int) {
    event(
      where: {
        module: { _eq: "multisig" }
        call: { _eq: "MultisigExecuted" }
        data: { _ilike: $addrLike }
      }
      order_by: { block_number: desc }
      limit: $limit
    ) {
      block_number
      event_index
      phase
      data
      timestamp
    }
  }
`;

const EXTRINSIC_QUERY = `
  query MultisigExtrinsic($block: bigint!, $idx: Int!) {
    extrinsic(where: {
      block_number: { _eq: $block }
      extrinsic_index: { _eq: $idx }
    }) {
      module
      call
      signer
      success
      fee
      nested_calls
    }
  }
`;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Indexer HTTP ${response.status}`);
  }
  const json = await response.json();
  if (json.errors) {
    throw new Error(`Indexer GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

/**
 * Parse the indexer's `phase` field (stored as a string, sometimes JSON).
 * Returns the extrinsic index (an integer) for `ApplyExtrinsic` phases,
 * or null for finalization/initialization phases (which don't correspond
 * to any single extrinsic).
 */
function extrinsicIndexFromPhase(phase: unknown): number | null {
  if (phase == null) return null;
  // Already-parsed object form
  if (typeof phase === 'object' && phase !== null) {
    const p = phase as Record<string, unknown>;
    const v = p.applyExtrinsic ?? p.ApplyExtrinsic;
    return typeof v === 'number' ? v : null;
  }
  // String form, possibly JSON-encoded
  if (typeof phase === 'string') {
    const trimmed = phase.trim();
    if (/^(finalization|initialization)$/i.test(trimmed)) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const v = parsed.applyExtrinsic ?? parsed.ApplyExtrinsic;
        return typeof v === 'number' ? v : null;
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}

/**
 * Extract the call hash from a MultisigExecuted event's data array. The
 * substrate event signature is roughly
 *   MultisigExecuted(approving, timepoint, multisig, call_hash, result)
 * with the call_hash at index 3 in the JSON-stringified data array we
 * observed in the spike. We parse defensively because event-data shape
 * has changed across runtime versions historically.
 */
function callHashFromEventData(data: unknown): string {
  let arr: unknown = data;
  if (typeof data === 'string') {
    try {
      arr = JSON.parse(data);
    } catch {
      return '';
    }
  }
  if (!Array.isArray(arr)) return '';
  // Find the first 0x-prefixed 64-hex-char string in the data — that's
  // the call hash. Position-independent so a runtime upgrade that
  // shuffles the event params doesn't silently break this.
  for (const item of arr) {
    if (typeof item === 'string' && /^0x[0-9a-f]{64}$/i.test(item)) {
      return item;
    }
  }
  return '';
}

interface UseMultisigActivityResult {
  activity: MultisigActivityItem[];
  isLoading: boolean;
  error: Error | null;
  /** Number of MultisigExecuted events found in the queried window.
   *  May be smaller than what's on chain if there are more than PAGE_SIZE. */
  total: number;
}

export function useMultisigActivity(
  multisigAddress: string | null | undefined
): UseMultisigActivityResult {
  const [activity, setActivity] = useState<MultisigActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!multisigAddress) {
      setActivity([]);
      setTotal(0);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Step 1: events at this multisig (filtered to executions).
        const { event } = await gql<{
          event: Array<{
            block_number: number | string;
            event_index: number;
            phase: unknown;
            data: unknown;
            timestamp: number | string;
          }>;
        }>(EVENTS_QUERY, {
          addrLike: `%${multisigAddress}%`,
          limit: PAGE_SIZE,
        });

        if (cancelled) return;

        // Step 2: enrich each with its extrinsic. Run in parallel — the
        // indexer can handle PAGE_SIZE concurrent queries without strain.
        const items = await Promise.all(
          event.map(async (e): Promise<MultisigActivityItem | null> => {
            const extIdx = extrinsicIndexFromPhase(e.phase);
            if (extIdx === null) return null;
            const blockNumber = Number(e.block_number);
            try {
              const { extrinsic } = await gql<{
                extrinsic: Array<{
                  module: string;
                  call: string;
                  signer: string;
                  success: boolean;
                  fee: string | number | null;
                  nested_calls: unknown;
                }>;
              }>(EXTRINSIC_QUERY, { block: blockNumber, idx: extIdx });
              const ext = extrinsic[0];
              if (!ext) return null;
              return {
                id: `${blockNumber}-${e.event_index}`,
                blockNumber,
                extrinsicIndex: extIdx,
                timestamp: Number(e.timestamp),
                signer: ext.signer,
                callHash: callHashFromEventData(e.data),
                success: ext.success,
                fee: ext.fee != null ? String(ext.fee) : null,
                nestedCalls: ext.nested_calls,
              };
            } catch {
              // One bad extrinsic shouldn't kill the whole timeline.
              return null;
            }
          })
        );

        if (cancelled) return;
        const cleaned = items.filter((x): x is MultisigActivityItem => x !== null);
        setActivity(cleaned);
        setTotal(cleaned.length);
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
          setActivity([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [multisigAddress]);

  return { activity, isLoading, error, total };
}
