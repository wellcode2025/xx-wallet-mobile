/**
 * useBounties — list view of every active bounty on chain.
 *
 * Pulls `bounties.bounties.entries()` once on mount,
 * pairs each with its description from `bounties.bountyDescriptions`,
 * decodes the status enum into a typed discriminant, and prefetches
 * proposer + curator identities so display names are warm by the time
 * the rows mount.
 *
 * The countdown for `updateDue` does NOT live here — it ticks off
 * `useConnectionStore.blockNumber`, which is subscribed once at app
 * boot. Components consume the timer via `governanceTimer` and re-render
 * on each chain head as the store updates.
 *
 * Past-bounty handling: closed bounties (awarded + claimed) are pruned
 * from chain storage. `bountyCount() - active.length` tells us how many
 * past bounties existed in total, but the per-id details aren't
 * retrievable from chain alone. The hook returns `pastCount` for the
 * "Past" tab to render an explorer-link stub rather than a list.
 *
 * Child bounties similarly: counted from
 * `api.query.childBounties.childBountyCount`, surfaced as `childCount`.
 * The list of currently-open child bounties (if any) lives in
 * `useBountyDetail` since they're parent-scoped.
 */

import { useEffect, useState } from 'react';
import type { BN } from '@polkadot/util';
import { xxApi } from '@/api';
import { resolveIdentitiesBatch } from '@/governance';
import { extractForumLink, type ExtractedForumLink } from '@/governance';
import {
  curatorAddressOf,
  decodeBountyStatus,
  type BountyStatus,
} from './bountyStatus';

export type { BountyStatus };
export { curatorAddressOf };

export interface BountySummary {
  id: number;
  proposer: string;
  value: BN;
  fee: BN;
  curatorDeposit: BN;
  bond: BN;
  status: BountyStatus;
  /** Decoded UTF-8 description from on-chain bytes. May contain HTML. */
  description: string;
  /** Parsed forum-link form of the description, for row + detail rendering. */
  descriptionLink: ExtractedForumLink;
}

interface UseBountiesResult {
  /** Active bounties, ordered newest-id-first. */
  bounties: BountySummary[];
  /** Total bountyCount ever created on chain (active + claimed combined). */
  totalCount: number;
  /** Number of past (claimed / closed) bounties — totalCount minus active.length. */
  pastCount: number;
  /** Number of currently-open child bounties across all parents. */
  childCount: number;
  isLoading: boolean;
  error: Error | null;
}

export function useBounties(): UseBountiesResult {
  const [state, setState] = useState<UseBountiesResult>({
    bounties: [],
    totalCount: 0,
    pastCount: 0,
    childCount: 0,
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

        // Three independent reads in parallel.
        const [bountyEntriesRaw, totalCountCodec, childCountCodec] =
          await Promise.all([
            api.query.bounties.bounties.entries(),
            api.query.bounties.bountyCount(),
            api.query.childBounties?.childBountyCount
              ? api.query.childBounties.childBountyCount()
              : Promise.resolve(null as any),
          ]);
        if (cancelled) return;

        // Filter to active (isSome) entries and structure them.
        const activeEntries: { id: number; bounty: any }[] = [];
        for (const [key, opt] of bountyEntriesRaw as any[]) {
          if (opt.isSome) {
            const id = (key.args[0] as { toNumber: () => number }).toNumber();
            activeEntries.push({ id, bounty: opt.unwrap() });
          }
        }
        // Newest first — the web wallet lists in descending id order.
        activeEntries.sort((a, b) => b.id - a.id);

        // Bulk-fetch descriptions for the active set.
        const descriptionResults = await Promise.all(
          activeEntries.map(async ({ id }) => {
            try {
              const opt: any = await api.query.bounties.bountyDescriptions(id);
              if (opt && opt.isSome) {
                return opt.unwrap().toUtf8();
              }
            } catch {
              /* fall through */
            }
            return '';
          })
        );
        if (cancelled) return;

        // Build the typed summaries.
        const summaries: BountySummary[] = activeEntries.map(({ id, bounty }, i) => ({
          id,
          proposer: bounty.proposer.toString(),
          value: bounty.value.toBn(),
          fee: bounty.fee.toBn(),
          curatorDeposit: bounty.curatorDeposit.toBn(),
          bond: bounty.bond.toBn(),
          status: decodeBountyStatus(bounty.status),
          description: descriptionResults[i],
          descriptionLink: extractForumLink(descriptionResults[i]),
        }));

        // Pre-warm the identity cache for every visible address. We collect
        // proposers + curators (where present) and fire one batch fetch —
        // the rows then read from cache synchronously on render.
        const idsToResolve = new Set<string>();
        for (const s of summaries) {
          idsToResolve.add(s.proposer);
          const curator = curatorAddressOf(s.status);
          if (curator) idsToResolve.add(curator);
        }
        // Don't await — let identity resolution happen in the background.
        // Components that need it will hit cache (if warm) or fall back to
        // the truncated SS58 (per displayName) while the fetch completes.
        if (idsToResolve.size > 0) {
          resolveIdentitiesBatch([...idsToResolve]).catch(() => {
            /* silent — identity resolution isn't load-bearing for the screen */
          });
        }

        const totalCount = (totalCountCodec as any).toNumber();
        const childCount = childCountCodec
          ? (childCountCodec as any).toNumber()
          : 0;

        setState({
          bounties: summaries,
          totalCount,
          pastCount: Math.max(0, totalCount - summaries.length),
          childCount,
          isLoading: false,
          error: null,
        });
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

