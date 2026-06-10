/**
 * useRewardsHistory — per-account staking rewards from the indexer.
 *
 * Architecture (verified against live xx network):
 *
 *   The indexer's `staking_reward` table tracks chain liveness — when
 *   verified, the latest recorded era was 1639 with chain at active era 1640
 *   (1-era lag, same as `transfer`). Unlike `validator_stats` (frozen
 *   2025-09-01), this table is current and can serve as the primary
 *   source for the Rewards view with no "as of <date>" framing.
 *
 *   Table is keyed on `account_id` (the receiving stash). One row per
 *   era per payout. Columns we use: era, validator_id, amount (raw
 *   planck, numeric → BN), block_number, timestamp (ms).
 *
 *   Window: last 90 eras, ordered `era desc`. Always pulls the freshest
 *   rows so the view stays current automatically.
 *
 * Fetch-once on address change.
 */

import { useEffect, useState } from 'react';
import { BN } from '@polkadot/util';

const INDEXER_URL = 'https://indexer.xx.network/v1/graphql';
const ERA_WINDOW = 90;

export interface RewardRow {
  era: number;
  /** Raw planck. xx network has 9 decimals — use formatBalance to render. */
  amount: BN;
  /** The validator whose pool this payout came from. For self-validators,
   *  this equals the account_id. For nominators, this is one of the
   *  validators they backed. */
  validator: string;
  blockNumber: number;
  /** Milliseconds since unix epoch (bigint from the indexer, narrowed to number). */
  timestamp: number;
}

export interface RewardsHistory {
  rows: RewardRow[];
  /** Sum of all amounts in the window. Zero if no rows. */
  totalOverWindow: BN;
  /** Number of eras with rewards in the window. */
  eraCount: number;
  /** [oldestEra, newestEra], or null if no rows. */
  eraRange: [number, number] | null;
}

const QUERY = `
  query RewardsForAccount($a: String!, $limit: Int!) {
    staking_reward(
      where: { account_id: { _eq: $a } }
      order_by: { era: desc }
      limit: $limit
    ) {
      era
      amount
      validator_id
      block_number
      timestamp
    }
  }
`;

export function useRewardsHistory(address: string | null | undefined): {
  history: RewardsHistory | null;
  isLoading: boolean;
  error: Error | null;
} {
  const [history, setHistory] = useState<RewardsHistory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!address) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const r = await fetch(INDEXER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: QUERY,
            variables: { a: address, limit: ERA_WINDOW },
          }),
        });
        if (!r.ok) throw new Error(`Indexer ${r.status}`);
        const json = await r.json();
        if (cancelled) return;
        if (json.errors?.length) {
          throw new Error(
            json.errors[0]?.message ?? 'Indexer query failed'
          );
        }
        const raw: Array<{
          era: number;
          amount: string;
          validator_id: string;
          block_number: string | number;
          timestamp: string | number;
        }> = json?.data?.staking_reward ?? [];

        const rows: RewardRow[] = raw.map((row) => ({
          era: row.era,
          amount: new BN(String(row.amount ?? '0')),
          validator: row.validator_id,
          blockNumber: Number(row.block_number ?? 0),
          timestamp: Number(row.timestamp ?? 0),
        }));
        const totalOverWindow = rows.reduce(
          (acc, r) => acc.add(r.amount),
          new BN(0)
        );
        const eraRange: [number, number] | null =
          rows.length > 0
            ? [rows[rows.length - 1].era, rows[0].era]
            : null;
        setHistory({
          rows,
          totalOverWindow,
          eraCount: rows.length,
          eraRange,
        });
      } catch (e) {
        if (!cancelled) setError(e as Error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  return { history, isLoading, error };
}
