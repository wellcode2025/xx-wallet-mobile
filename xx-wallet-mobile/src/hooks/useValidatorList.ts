/**
 * useValidatorList — the current validator set with live commission,
 * total stake, and era points.
 *
 * Architecture (verified against live xx network):
 * the indexer's validator_stats table lags the chain by ~255 eras, so
 * it cannot define the current set or carry live numbers. Chain-first:
 *
 *   - set + commission + blocked:  chain staking.validators.entries()
 *     — one bulk call, the authoritative current set (237 validators).
 *   - total stake:                 chain staking.erasStakersClipped
 *     .entries(activeEra) — one bulk call.
 *   - era points:                  chain staking.erasRewardPoints(era)
 *     — one call, all validators.
 *   - identity display name:       indexer `account where validator=true`
 *     — one GraphQL query, joined onto the chain spine as pure
 *     enrichment. A momentarily out-of-sync indexer just means a
 *     missing name, never a missing validator.
 *
 * Every chain read is a bulk .entries() / single call — never a
 * per-validator loop. Measured on the live chain: per-validator
 * queries at ~800ms each (~2 minutes for the full set); bulk calls
 * run ~1s.
 *
 * Fetch-once, like useStakingPosition — era-snapshot data that can't
 * change within an era.
 *
 * Note: total stake is read from erasStakersClipped (the rewarded set),
 * consistent with useStakingPosition. That's the rewarded-set total,
 * not the full unclipped backing — the two diverge only for validators
 * with very large nominator counts. Swap to erasStakers if the full
 * backing number is wanted on the list.
 */

import { useEffect, useState } from 'react';
import { hexToString, type BN } from '@polkadot/util';
import { xxApi } from '@/api';
import { indexerQuery } from '@/api/indexer';

export interface ValidatorListEntry {
  /** Validator stash address. */
  address: string;
  /** On-chain identity display name from the indexer, or null. */
  displayName: string | null;
  /** Commission as a percent, 0-100. */
  commission: number;
  /** True if the validator has blocked new nominations. */
  blocked: boolean;
  /** True if the validator is in the elected set this era. */
  isActive: boolean;
  /** Current-era total backing stake; null if not in the elected set. */
  totalStake: BN | null;
  /** Current-era reward points; 0 if not elected or none earned yet. */
  eraPoints: number;
}

interface UseValidatorListResult {
  validators: ValidatorListEntry[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Indexer enrichment: identity display names for the current validator
 * set. Failure is non-fatal — the list just renders address fragments
 * instead of names.
 */
async function fetchValidatorDisplayNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const data = await indexerQuery<{
      account?: Array<{
        account_id?: string;
        identity?: { display?: string } | null;
      }>;
    }>(`query {
      account(where: { validator: { _eq: true } }) {
        account_id
        identity { display }
      }
    }`);
    for (const a of data.account ?? []) {
      const display = a?.identity?.display;
      if (a?.account_id && display) names.set(a.account_id, display);
    }
  } catch {
    // Identity is enrichment only — never fatal to the list. This also
    // quietly covers the indexer-disabled privacy setting: names from
    // the chain (fetchChainDisplayNames) still apply.
  }
  return names;
}

/**
 * Chain identity display names for the given validator addresses, via a
 * single batched identityOf.multi call (not a per-validator loop). The
 * chain is authoritative for identity; the indexer's account.identity is
 * often sparse, so names are read here the same way the detail screen
 * resolves them. Best-effort: any parse failure just yields no name for
 * that validator.
 */
async function fetchChainDisplayNames(
  api: any,
  addresses: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    if (!api.query.identity?.identityOf || addresses.length === 0) return names;
    const results: any[] = await api.query.identity.identityOf.multi(addresses);
    results.forEach((res, i) => {
      try {
        if (!res || res.isNone) return;
        const raw = res.toJSON ? res.toJSON() : null;
        const reg = Array.isArray(raw) ? raw[0] : raw;
        const displayRaw = reg?.info?.display?.raw;
        if (typeof displayRaw === 'string') {
          const name = hexToString(displayRaw).trim();
          if (name) names.set(addresses[i], name);
        }
      } catch {
        /* skip this validator's name */
      }
    });
  } catch {
    /* identity unavailable — names are enrichment, never fatal */
  }
  return names;
}

export function useValidatorList(): UseValidatorListResult {
  const [validators, setValidators] = useState<ValidatorListEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setValidators([]);
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

        // Bulk chain reads — never per-validator loops.
        const [prefsEntries, exposureEntries, rewardPoints] = await Promise.all(
          [
            api.query.staking.validators.entries(),
            activeEra !== null
              ? api.query.staking.erasStakersClipped.entries(activeEra)
              : Promise.resolve([] as any[]),
            activeEra !== null
              ? api.query.staking.erasRewardPoints(activeEra)
              : Promise.resolve(null),
          ]
        );
        if (cancelled) return;

        // Total stake by validator address. erasStakersClipped is a
        // double map keyed [era, validator] — the validator is the
        // second key arg.
        const stakeByAddr = new Map<string, BN>();
        for (const [key, exposure] of exposureEntries as any[]) {
          const addr = key.args[1].toString();
          stakeByAddr.set(addr, exposure.total.toBn());
        }

        // Era points by validator address.
        const pointsByAddr = new Map<string, number>();
        if (rewardPoints) {
          (rewardPoints as any).individual.forEach(
            (points: any, accountId: any) => {
              pointsByAddr.set(accountId.toString(), Number(points.toString()));
            }
          );
        }

        // Identity display names — chain-first (authoritative, the same
        // source the detail screen uses), with the indexer as a fallback
        // for any the chain doesn't resolve.
        const addresses = (prefsEntries as any[]).map(([key]) =>
          key.args[0].toString()
        );
        const [chainNames, indexerNames] = await Promise.all([
          fetchChainDisplayNames(api, addresses),
          fetchValidatorDisplayNames(),
        ]);
        if (cancelled) return;

        // staking.validators.entries() is the spine — the authoritative
        // current set. Everything else joins onto it by address.
        const list: ValidatorListEntry[] = (prefsEntries as any[]).map(
          ([key, prefs]) => {
            const address = key.args[0].toString();
            const stake = stakeByAddr.get(address) ?? null;
            return {
              address,
              displayName:
                chainNames.get(address) ?? indexerNames.get(address) ?? null,
              commission: Number(prefs.commission.toString()) / 1e7,
              blocked: prefs.blocked?.isTrue === true,
              isActive: stake !== null,
              totalStake: stake,
              eraPoints: pointsByAddr.get(address) ?? 0,
            };
          }
        );

        setValidators(list);
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
  }, []);

  return { validators, isLoading, error };
}
