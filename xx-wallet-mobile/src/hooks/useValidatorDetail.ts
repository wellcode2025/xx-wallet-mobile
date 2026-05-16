/**
 * useValidatorDetail — per-validator deep view for the slice-3 screen.
 *
 * Architecture, settled by the slice-3 spike (validator-detail-spike.mjs):
 *
 *   Live from chain (the source of truth for anything users might act on):
 *     - ValidatorPrefs            commission, blocked
 *     - bonded + ledger           total/active bond, cmixId (Option<H256>)
 *     - cmix_id transform         H256 bytes + [2] byte → base64, matching
 *                                 the foundation's custom derive verbatim
 *                                 (spike cross-check vs the indexer's
 *                                 cmix_id confirmed bit-identical output)
 *     - erasStakersClipped        current-era total/own/backers list
 *     - erasRewardPoints          current-era points + network share
 *     - identity                  full on-chain identity via fetchIdentity
 *                                 (now actually-working post-71a9546+today)
 *
 *   Historical snapshot from indexer (framed clearly as "as of <date>" in
 *   the UI, because `validator_stats` is frozen at era 1384 = 2025-09-01):
 *     - location                  JSON: { city, country, geoBin }
 *     - relative_performance      0..1 float, comparative metric
 *     - points-per-era series     last 90 eras of the validator's history,
 *                                 powering the SparkBarChart
 *
 *   Skipped: indexer's nominators JSON (stale; chain has the live list),
 *   indexer's cmix_id (have live equivalent — proven match).
 *
 * Fetch-once on address change. Era-snapshot data doesn't change within
 * an era; subscriptions would be waste.
 */

import { useEffect, useState } from 'react';
import type { BN } from '@polkadot/util';
import { u8aConcat } from '@polkadot/util';
import { base64Encode } from '@polkadot/util-crypto';
import { xxApi, fetchIdentity } from '@/api';
import type { OnChainIdentity } from '@/store';

const INDEXER_URL = 'https://indexer.xx.network/v1/graphql';
const HISTORY_ERAS = 90;

export interface ValidatorLocation {
  city: string;
  country: string;
  geoBin: string;
}

export interface ValidatorEraPoints {
  era: number;
  points: number;
}

export interface ValidatorDetail {
  address: string;
  // ── Chain (live) ───────────────────────────────────────────────────
  /** Commission as a percent, 0..100. */
  commission: number;
  /** True if the validator has blocked new nominations. */
  blocked: boolean;
  /** Total bonded amount, or null if not bonded. */
  bondedTotal: BN | null;
  /** Active bonded amount (total minus anything unbonding). */
  bondedActive: BN | null;
  /** cMix node operator id, base64 (transformed from staking ledger). */
  cmixId: string | null;
  /** Era whose exposure / points are reported below. */
  currentEra: number | null;
  /** Current-era total backing stake (clipped). Null if not in the elected set. */
  currentEraTotalStake: BN | null;
  /** Current-era self-stake (validator's own bond). */
  currentEraOwnStake: BN | null;
  /** Current-era reward points earned by this validator. */
  currentEraPoints: number;
  /** Current-era network-wide reward points (denominator for share). */
  currentEraNetworkPoints: number;
  /** Live list of nominators backing this validator in the current era. */
  currentBackers: { address: string; stake: BN }[];
  // ── Indexer ────────────────────────────────────────────────────────
  /** Full on-chain identity — display, legal, email, web, twitter, riot. */
  identity: OnChainIdentity | null;
  /** Last validator_stats row for this validator. Null if no history. */
  historicalSnapshot: {
    era: number;
    /** ms epoch — for the "as of <date>" UI frame. */
    timestamp: number;
    location: ValidatorLocation | null;
    relativePerformance: number | null;
  } | null;
  /** Up to HISTORY_ERAS most-recent points-per-era, oldest → newest. */
  pointsHistory: ValidatorEraPoints[];
}

interface UseValidatorDetailResult {
  validator: ValidatorDetail | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Foundation's cMix-id transform (staking.xx.network's custom derive):
 * 32-byte H256 + [2] byte, base64-encoded. Spike confirmed bit-identical
 * output to the indexer's recorded cmix_id.
 */
function transformCmixId(h256: any): string | null {
  if (!h256) return null;
  try {
    const bytes = h256.toU8a(true);
    const combined = u8aConcat(bytes, new Uint8Array([2]));
    return base64Encode(combined);
  } catch {
    return null;
  }
}

function parseLocation(
  raw: string | null | undefined
): ValidatorLocation | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (typeof obj?.city === 'string' && typeof obj?.country === 'string') {
      return {
        city: obj.city,
        // Indexer stores country with a leading space sometimes
        // (" Switzerland"); normalize.
        country: typeof obj.country === 'string' ? obj.country.trim() : obj.country,
        geoBin: typeof obj.geoBin === 'string' ? obj.geoBin : '',
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

async function fetchHistoricalData(address: string): Promise<{
  snapshot: ValidatorDetail['historicalSnapshot'];
  pointsHistory: ValidatorEraPoints[];
}> {
  try {
    const r = await fetch(INDEXER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query ($addr: String!, $limit: Int!) {
          latest: validator_stats(
            where: { stash_address: { _eq: $addr } }
            order_by: { era: desc }
            limit: 1
          ) { era timestamp location relative_performance }
          history: validator_stats(
            where: { stash_address: { _eq: $addr } }
            order_by: { era: desc }
            limit: $limit
          ) { era points }
        }`,
        variables: { addr: address, limit: HISTORY_ERAS },
      }),
    });
    if (!r.ok) return { snapshot: null, pointsHistory: [] };
    const json = await r.json();
    if (json.errors) return { snapshot: null, pointsHistory: [] };
    const latest = json?.data?.latest?.[0];
    const historyRaw: { era: number; points: number | null }[] =
      json?.data?.history ?? [];
    return {
      snapshot: latest
        ? {
            era: latest.era,
            timestamp: Number(latest.timestamp),
            location: parseLocation(latest.location),
            relativePerformance: latest.relative_performance ?? null,
          }
        : null,
      // Query returns newest-first; chart wants oldest → newest.
      pointsHistory: [...historyRaw]
        .reverse()
        .map((row) => ({ era: row.era, points: row.points ?? 0 })),
    };
  } catch {
    return { snapshot: null, pointsHistory: [] };
  }
}

export function useValidatorDetail(
  address: string | null | undefined
): UseValidatorDetailResult {
  const [validator, setValidator] = useState<ValidatorDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!address) {
      setValidator(null);
      return;
    }

    let cancelled = false;
    setValidator(null);
    setError(null);
    setIsLoading(true);

    (async () => {
      try {
        const api = await xxApi.getApi();
        if (cancelled) return;

        const activeEraOpt: any = await api.query.staking.activeEra();
        const activeEra: number | null = activeEraOpt?.isSome
          ? activeEraOpt.unwrap().index.toNumber()
          : null;

        // Bulk chain reads — three independent calls in parallel.
        const [prefs, bondedOpt, rewardPoints] = await Promise.all([
          api.query.staking.validators(address) as Promise<any>,
          api.query.staking.bonded(address) as Promise<any>,
          activeEra !== null
            ? (api.query.staking.erasRewardPoints(activeEra) as Promise<any>)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;

        // Ledger depends on bonded.
        let bondedTotal: BN | null = null;
        let bondedActive: BN | null = null;
        let cmixId: string | null = null;
        if (bondedOpt?.isSome) {
          const controller = bondedOpt.unwrap().toString();
          const ledgerOpt: any = await api.query.staking.ledger(controller);
          if (ledgerOpt?.isSome) {
            const ledger = ledgerOpt.unwrap();
            bondedTotal = ledger.total.toBn();
            bondedActive = ledger.active.toBn();
            const cmixField = ledger.cmixId;
            if (cmixField?.isSome) {
              cmixId = transformCmixId(cmixField.unwrap());
            }
          }
        }
        if (cancelled) return;

        // Current-era exposure.
        let currentEraTotalStake: BN | null = null;
        let currentEraOwnStake: BN | null = null;
        let currentBackers: { address: string; stake: BN }[] = [];
        if (activeEra !== null) {
          const exp: any = await api.query.staking.erasStakersClipped(
            activeEra,
            address
          );
          currentEraTotalStake = exp.total?.toBn?.() ?? null;
          currentEraOwnStake = exp.own?.toBn?.() ?? null;
          const others = exp.others ?? [];
          currentBackers = others.map((o: any) => ({
            address: o.who.toString(),
            stake: o.value.toBn(),
          }));
        }
        if (cancelled) return;

        // Current-era points — extract this validator's share.
        let currentEraPoints = 0;
        let currentEraNetworkPoints = 0;
        if (rewardPoints) {
          rewardPoints.individual.forEach((points: any, accountId: any) => {
            if (accountId.toString() === address) {
              currentEraPoints = Number(points.toString());
            }
          });
          currentEraNetworkPoints = Number(rewardPoints.total.toString());
        }

        // Identity + historical — independent, parallel.
        const [identity, historical] = await Promise.all([
          fetchIdentity(address),
          fetchHistoricalData(address),
        ]);
        if (cancelled) return;

        setValidator({
          address,
          commission: Number(prefs.commission.toString()) / 1e7,
          blocked: prefs.blocked?.isTrue === true,
          bondedTotal,
          bondedActive,
          cmixId,
          currentEra: activeEra,
          currentEraTotalStake,
          currentEraOwnStake,
          currentEraPoints,
          currentEraNetworkPoints,
          currentBackers,
          identity,
          historicalSnapshot: historical.snapshot,
          pointsHistory: historical.pointsHistory,
        });
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  return { validator, isLoading, error };
}
