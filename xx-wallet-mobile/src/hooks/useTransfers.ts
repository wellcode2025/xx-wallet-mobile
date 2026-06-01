/**
 * useTransfers — fetch transfer history for an account from indexer.xx.network
 *
 * Uses the same GraphQL API that powers explorer.xx.network, querying the
 * official xx foundation indexer directly. This gives us full historical
 * transfer data instantly — no block scanning required.
 *
 * Query confirmed from explorer.xx.network network inspection:
 *   endpoint: https://indexer.xx.network/v1/graphql
 *   operation: ListTransfersOrdered
 *   table: transfer
 *   fields: block_number, event_index, extrinsic_index, source, destination,
 *           amount, timestamp, account (sourceAccount), accountByDestination,
 *           block { era }, extrinsic { hash, success }
 */

import { useEffect, useState } from 'react';
import BigNumber from 'bignumber.js';
import { XX_DECIMALS } from '@/api';

export type TxDirection = 'in' | 'out' | 'self';

export interface Transfer {
  id: string;
  blockNumber: number;
  eventIndex: number;
  extrinsicIndex: number;
  timestamp: number;
  from: string;
  to: string;
  amount: string; // raw planck string as returned by indexer
  direction: TxDirection;
  success: boolean;
  txHash: string;
  era: number;
  /** Base extrinsic fee in raw planck. May be null on very old txs. */
  fee: string | null;
  /** Optional tip in raw planck. NON_NULL on the indexer side — defaults to "0". */
  tip: string;
  // Optional identity display names from the indexer
  fromIdentity?: string | null;
  toIdentity?: string | null;
}

const INDEXER_URL = 'https://indexer.xx.network/v1/graphql';
const PAGE_SIZE = 20;

// Confirmed query from explorer.xx.network payload inspection.
//
// NOTE: roles_fragment is included in the query but the mapped
// Transfer type does not yet expose the role fields (validator, nominator,
// council, techcommit, special). This is intentional dead weight kept
// as a seed for staking views — the same way fetchAccountRoles in
// src/api/identity.ts is kept. Either drop the fragment from the query
// (lighter response) or surface the role data on Transfer (small UI badges
// next to addresses). Do not silently drop without checking the
// staking-views design first.
const LIST_TRANSFERS_QUERY = `
  fragment roles_fragment on account {
    techcommit
    special
    nominator
    council
    validator
    __typename
  }

  fragment transfer_fragment on transfer {
    blockNumber: block_number
    eventIndex: event_index
    extrinsicIndex: extrinsic_index
    source
    destination
    amount
    timestamp
    sourceAccount: account {
      ...roles_fragment
      identity {
        display
        __typename
      }
      __typename
    }
    destinationAccount: accountByDestination {
      ...roles_fragment
      identity {
        display
        __typename
      }
      __typename
    }
    block {
      era
      __typename
    }
    extrinsic {
      hash
      success
      fee
      tip
      __typename
    }
    __typename
  }

  query ListTransfersOrdered(
    $orderBy: [transfer_order_by!]
    $limit: Int
    $offset: Int
    $where: transfer_bool_exp
  ) {
    transfers: transfer(
      order_by: $orderBy
      limit: $limit
      offset: $offset
      where: $where
    ) {
      ...transfer_fragment
      __typename
    }
    agg: transfer_aggregate(where: $where) {
      aggregate {
        count
        __typename
      }
      __typename
    }
  }
`;

export function useTransfers(address: string | null | undefined): {
  transfers: Transfer[];
  isLoading: boolean;
  error: Error | null;
  total: number;
} {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!address) {
      setTransfers([]);
      setTotal(0);
      return;
    }

    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Also fetch total count in the same request
        const response = await fetch(INDEXER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operationName: 'ListTransfersOrdered',
            query: LIST_TRANSFERS_QUERY,
            variables: {
              limit: PAGE_SIZE,
              offset: 0,
              orderBy: [{ timestamp: 'desc' }],
              where: {
                _or: [
                  { source: { _eq: address } },
                  { destination: { _eq: address } },
                ],
              },
            },
          }),
        });

        if (!response.ok) throw new Error(`Indexer error: ${response.status}`);
        const json = await response.json();
        if (cancelled) return;

        const raw = json?.data?.transfers ?? [];
        const count = json?.data?.agg?.aggregate?.count ?? 0;

        const mapped = raw.map((t: any): Transfer => {
          const direction: TxDirection =
            t.source === address && t.destination === address
              ? 'self'
              : t.source === address
              ? 'out'
              : 'in';

          return {
            id: `${t.blockNumber}-${t.eventIndex}`,
            blockNumber: t.blockNumber,
            eventIndex: t.eventIndex,
            extrinsicIndex: t.extrinsicIndex,
            timestamp: t.timestamp,
            from: t.source,
            to: t.destination,
            amount: String(t.amount),
            direction,
            success: t.extrinsic?.success ?? true,
            txHash: t.extrinsic?.hash ?? '',
            era: t.block?.era ?? 0,
            fee: t.extrinsic?.fee != null ? String(t.extrinsic.fee) : null,
            tip: String(t.extrinsic?.tip ?? '0'),
            fromIdentity: t.sourceAccount?.identity?.display ?? null,
            toIdentity: t.destinationAccount?.identity?.display ?? null,
          };
        });

        setTransfers(mapped);
        setTotal(count);
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [address]);

  return { transfers, isLoading, error, total };
}

export function planckToHuman(raw: string): string {
  return new BigNumber(raw)
    .div(new BigNumber(10).pow(XX_DECIMALS))
    .toFixed(4)
    .replace(/\.?0+$/, '');
}
