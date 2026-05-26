/**
 * useBountyDetail — fetch a single bounty plus any child bounties it has.
 *
 * Used by `/governance/bounties/:id`. Returns the same BountySummary
 * shape useBounties returns, plus a `childBounties` array.
 *
 * Like useBounties, this hook does a one-shot fetch and relies on the
 * connection store's blockNumber subscription for live updateDue ticks.
 */

import { useEffect, useState } from 'react';
import type { BN } from '@polkadot/util';
import { xxApi } from '@/api';
import { extractForumLink, type ExtractedForumLink } from '@/governance';
import { resolveIdentitiesBatch } from '@/governance';
import {
  curatorAddressOf,
  decodeBountyStatus,
  type BountyStatus,
} from './bountyStatus';

export interface ChildBountySummary {
  parentId: number;
  childId: number;
  value: BN;
  fee: BN;
  curatorDeposit: BN;
  status: BountyStatus;
  description: string;
  descriptionLink: ExtractedForumLink;
}

export interface BountyDetail {
  id: number;
  proposer: string;
  value: BN;
  fee: BN;
  curatorDeposit: BN;
  bond: BN;
  status: BountyStatus;
  description: string;
  descriptionLink: ExtractedForumLink;
  childBounties: ChildBountySummary[];
}

interface UseBountyDetailResult {
  bounty: BountyDetail | null;
  isLoading: boolean;
  error: Error | null;
}

export function useBountyDetail(
  id: number | null | undefined
): UseBountyDetailResult {
  const [state, setState] = useState<UseBountyDetailResult>({
    bounty: null,
    isLoading: false,
    error: null,
  });

  useEffect(() => {
    if (id == null) {
      setState({ bounty: null, isLoading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ bounty: null, isLoading: true, error: null });

    (async () => {
      try {
        const api = await xxApi.getApi();
        if (cancelled) return;

        const bountyOpt: any = await api.query.bounties.bounties(id);
        if (cancelled) return;
        if (!bountyOpt?.isSome) {
          setState({
            bounty: null,
            isLoading: false,
            error: new Error(`Bounty #${id} not found on chain`),
          });
          return;
        }
        const bounty = bountyOpt.unwrap();

        // Description in parallel with child bounties.
        const [descriptionRaw, childEntries] = await Promise.all([
          (async () => {
            try {
              const opt: any = await api.query.bounties.bountyDescriptions(id);
              if (opt?.isSome) return opt.unwrap().toUtf8();
            } catch {
              /* fall through */
            }
            return '';
          })(),
          (async () => {
            const q = api.query.childBounties;
            if (!q?.childBounties?.entries) return [] as any[];
            try {
              // entries(parentId) returns the children of this parent.
              return (await q.childBounties.entries(id)) as any[];
            } catch {
              return [] as any[];
            }
          })(),
        ]);
        if (cancelled) return;

        const status = decodeBountyStatus(bounty.status);
        const description = descriptionRaw as string;

        const childBounties: ChildBountySummary[] = [];
        for (const [key, opt] of childEntries) {
          if (!opt.isSome) continue;
          const childId = (key.args[1] as { toNumber: () => number }).toNumber();
          const c = opt.unwrap();
          let childDesc = '';
          try {
            const dOpt: any = await api.query.childBounties.childBountyDescriptions?.(
              id,
              childId
            );
            if (dOpt?.isSome) childDesc = dOpt.unwrap().toUtf8();
          } catch {
            /* leave empty */
          }
          childBounties.push({
            parentId: id,
            childId,
            value: c.value.toBn(),
            fee: c.fee.toBn(),
            curatorDeposit: c.curatorDeposit.toBn(),
            status: decodeBountyStatus(c.status),
            description: childDesc,
            descriptionLink: extractForumLink(childDesc),
          });
        }

        // Prefetch identities (proposer + curator + child curators).
        const ids = new Set<string>();
        ids.add(bounty.proposer.toString());
        const cur = curatorAddressOf(status);
        if (cur) ids.add(cur);
        for (const cb of childBounties) {
          const c = curatorAddressOf(cb.status);
          if (c) ids.add(c);
        }
        if (ids.size > 0) {
          resolveIdentitiesBatch([...ids]).catch(() => {
            /* silent */
          });
        }

        if (cancelled) return;
        setState({
          bounty: {
            id,
            proposer: bounty.proposer.toString(),
            value: bounty.value.toBn(),
            fee: bounty.fee.toBn(),
            curatorDeposit: bounty.curatorDeposit.toBn(),
            bond: bounty.bond.toBn(),
            status,
            description,
            descriptionLink: extractForumLink(description),
            childBounties,
          },
          isLoading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          bounty: null,
          isLoading: false,
          error: err as Error,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  return state;
}

