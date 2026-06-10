/**
 * usePendingMultisigs — live-subscribe to pending multisig proposals.
 *
 * Two flavors:
 *
 *   - `usePendingMultisigs(addr)` — pending proposals at a single multisig.
 *     Used by the multisig detail screen and the approval flow.
 *
 *   - `useAllPendingMultisigs()` — aggregated pending across every multisig
 *     in the user's local store. Used by the dropdown's "Pending actions"
 *     section, which surfaces everything that needs the user's attention.
 *
 * Reactivity: both refetch on every new finalized head from the chain. We
 * deliberately don't use per-(account, hash) storage subscriptions because
 * we don't know the call hashes ahead of time — `multisig.multisigs` is
 * keyed on (account, hash) and we have to call `.entries(account)` to
 * discover what's there. Re-fetching on each new block (~6s) is cheap
 * enough at the foundation's scale (a handful of pending items at most)
 * and gives responsive updates without per-key subscription bookkeeping.
 *
 * Authority note: pending state ALWAYS comes from the
 * chain — never the indexer. The indexer is for historical activity only.
 * "Is this proposal still pending?" is the kind of question where staleness
 * matters and the chain is the single source of truth.
 */

import { useEffect, useState } from 'react';
import type { ApiPromise } from '@polkadot/api';
import { xxApi } from '@/api';
import { useMultisigsStore } from '@/store/multisigs';

export interface PendingMultisigItem {
  /** Multisig account this proposal is at. */
  multisigAddress: string;
  /** On-chain call hash (0x-prefixed, lowercased). */
  callHash: string;
  /** Account that initiated the proposal and is paying the deposit. */
  depositor: string;
  /** Cosigners who've signed (including the depositor). Length compared
   *  against the multisig's threshold tells you how close to executing it
   *  is — at threshold-1 approvals, the next signature executes the call. */
  approvals: string[];
  /** When the proposal was first submitted on chain. The (block, index)
   *  pair forms the `Timepoint` argument needed for any subsequent
   *  approve/cancel call against this proposal. */
  whenBlock: number;
  whenIndex: number;
  /** Deposit reserved at the depositor's account, in raw planck. */
  deposit: string;
}

interface UsePendingResult {
  pending: PendingMultisigItem[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Subscribe to pending proposals at a single multisig address.
 */
export function usePendingMultisigs(
  multisigAddress: string | null | undefined
): UsePendingResult {
  const [pending, setPending] = useState<PendingMultisigItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!multisigAddress) {
      setPending([]);
      return;
    }

    let cancelled = false;
    let unsubBlocks: (() => void) | null = null;
    let api: ApiPromise | null = null;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        api = await xxApi.getApi();
        if (cancelled) return;

        // Initial fetch
        const items = await fetchPendingForMultisig(api, multisigAddress);
        if (cancelled) return;
        setPending(items);
        setIsLoading(false);

        // Re-fetch on every new finalized head. We use subscribeNewHeads
        // (not subscribeFinalizedHeads) for snappier UX — the worst case
        // is showing a proposal that ends up reorged out, which is
        // exceptionally rare on xx network and the next block fixes it.
        const unsub = await api.rpc.chain.subscribeNewHeads(async () => {
          if (cancelled) return;
          try {
            const next = await fetchPendingForMultisig(api!, multisigAddress);
            if (!cancelled) setPending(next);
          } catch {
            // Don't kill the subscription on a transient fetch failure.
          }
        });
        unsubBlocks = unsub as unknown as () => void;
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubBlocks?.();
    };
  }, [multisigAddress]);

  return { pending, isLoading, error };
}

/**
 * Subscribe to pending proposals across all multisigs in the user's
 * local store. Used by the dropdown's "Pending actions" section.
 *
 * Internally this fetches per-multisig in parallel on each new block.
 * Cheap at the foundation's scale (handful of multisigs, handful of
 * pending each); if the user ever has dozens of multisigs and we feel
 * any latency, we can switch to a smarter incremental approach.
 */
export function useAllPendingMultisigs(): UsePendingResult {
  const multisigs = useMultisigsStore((s) => s.multisigs);
  const [pending, setPending] = useState<PendingMultisigItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Stable string key for the deps array — Zustand returns a fresh array
  // reference on every change, but we want to re-subscribe only when the
  // set of multisig addresses actually changes (not just when other
  // multisig fields like localName change).
  const addresses = multisigs.map((m) => m.address).sort();
  const addressesKey = addresses.join('|');

  useEffect(() => {
    if (addresses.length === 0) {
      setPending([]);
      return;
    }

    let cancelled = false;
    let unsubBlocks: (() => void) | null = null;
    let api: ApiPromise | null = null;

    const refetchAll = async () => {
      if (!api) return;
      try {
        const results = await Promise.all(
          addresses.map((a) => fetchPendingForMultisig(api!, a))
        );
        if (cancelled) return;
        const merged = results.flat();
        // Sort newest-proposal-first so the dropdown shows recent
        // activity at the top.
        merged.sort((a, b) => b.whenBlock - a.whenBlock);
        setPending(merged);
      } catch {
        // Same as the single-multisig case — don't kill the subscription
        // on a transient error.
      }
    };

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        api = await xxApi.getApi();
        if (cancelled) return;

        await refetchAll();
        if (!cancelled) setIsLoading(false);

        const unsub = await api.rpc.chain.subscribeNewHeads(async () => {
          await refetchAll();
        });
        unsubBlocks = unsub as unknown as () => void;
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubBlocks?.();
    };
    // addressesKey captures the meaningful change (set of addresses).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressesKey]);

  return { pending, isLoading, error };
}

/**
 * One-shot fetch of pending proposals at a multisig. Internal — the public
 * interfaces are the two hooks above, which compose this with subscription
 * lifecycle management.
 */
async function fetchPendingForMultisig(
  api: ApiPromise,
  multisigAddress: string
): Promise<PendingMultisigItem[]> {
  const entries = await api.query.multisig.multisigs.entries(multisigAddress);
  const items: PendingMultisigItem[] = [];
  for (const [key, value] of entries) {
    const v = value as unknown as { isNone: boolean; unwrap: () => unknown };
    if (v.isNone) continue;
    const ms = v.unwrap() as {
      when: { height: { toNumber: () => number }; index: { toNumber: () => number } };
      depositor: { toString: () => string };
      deposit: { toString: () => string };
      approvals: Array<{ toString: () => string }>;
    };
    const callHash = (key.args[1] as unknown as { toHex: () => string }).toHex();
    items.push({
      multisigAddress,
      callHash: callHash.toLowerCase(),
      depositor: ms.depositor.toString(),
      approvals: ms.approvals.map((a) => a.toString()),
      whenBlock: ms.when.height.toNumber(),
      whenIndex: ms.when.index.toNumber(),
      deposit: ms.deposit.toString(),
    });
  }
  return items;
}
