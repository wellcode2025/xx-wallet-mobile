/**
 * useAutoNominate — wraps `selectValidators` for React with a
 * module-level cache so a pre-fetch from one component (typically the
 * StakingLayout on mount) warms the result for the bond flow.
 *
 * The Phase 3 spike measured ~6.2s wall time for the chain reads +
 * Phragmén pass at era 1641. That's a real loading state — pre-fetching
 * lets the bond screen open warm in the common case. If the cache is
 * stale or for a different address, the hook re-fetches and shows
 * isComputing=true.
 *
 * Pre-fetch pattern:
 *   useAutoNominate(activeAddress, { mode: 'prefetch' })
 *   — fires the fetch in the background, doesn't render anything.
 *
 * Consume pattern:
 *   useAutoNominate(activeAddress, { mode: 'consume' })
 *   — returns the cached result if warm, otherwise fires + waits.
 */

import { useCallback, useEffect, useState } from 'react';
import { xxApi } from '@/api';
import {
  selectValidators,
  type AutoNominateResult,
  type ValidatorFilter,
} from '@/staking';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
let cachedResult: AutoNominateResult | null = null;
let cachedForAddress: string | null = null;
let cachedAt = 0;
let inflight: Promise<AutoNominateResult> | null = null;
let inflightForAddress: string | null = null;
/** Bumped on every cache mutation so subscribed hooks rerun. */
let revision = 0;
const subscribers = new Set<() => void>();

function notifySubscribers() {
  revision += 1;
  subscribers.forEach((cb) => cb());
}

function getCached(address: string): AutoNominateResult | null {
  if (cachedForAddress !== address) return null;
  if (Date.now() - cachedAt > CACHE_TTL_MS) return null;
  return cachedResult;
}

async function triggerSelect(
  address: string,
  customFilters: ValidatorFilter[]
): Promise<AutoNominateResult> {
  // Coalesce concurrent calls for the same address
  if (inflight && inflightForAddress === address) return inflight;
  const api = await xxApi.getApi();
  inflightForAddress = address;
  inflight = (async () => {
    try {
      const result = await selectValidators(api, {
        nominator: address,
        customFilters,
      });
      cachedResult = result;
      cachedForAddress = address;
      cachedAt = Date.now();
      notifySubscribers();
      return result;
    } finally {
      inflight = null;
      inflightForAddress = null;
    }
  })();
  return inflight;
}

/** Clear the cached result. Call after a successful bond+nominate so a
 *  subsequent bond flow re-selects rather than showing stale picks. */
export function invalidateAutoNominateCache() {
  cachedResult = null;
  cachedForAddress = null;
  cachedAt = 0;
  notifySubscribers();
}

export interface UseAutoNominateOptions {
  /** prefetch = fire the fetch but don't block render. consume = return the
   *  cached result if warm, otherwise fire + wait. Default 'consume'. */
  mode?: 'prefetch' | 'consume';
  customFilters?: ValidatorFilter[];
}

export interface UseAutoNominateReturn {
  result: AutoNominateResult | null;
  isComputing: boolean;
  error: Error | null;
  /** Force a re-fetch, bypassing the cache. */
  refresh: () => void;
}

export function useAutoNominate(
  address: string | null | undefined,
  options: UseAutoNominateOptions = {}
): UseAutoNominateReturn {
  const { mode = 'consume', customFilters = [] } = options;
  const [, setLocalRevision] = useState(0);
  const [isComputing, setIsComputing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Subscribe to cache changes
  useEffect(() => {
    const cb = () => setLocalRevision(revision);
    subscribers.add(cb);
    return () => {
      subscribers.delete(cb);
    };
  }, []);

  // Fire selection when needed
  useEffect(() => {
    if (!address) return;
    const cached = getCached(address);
    if (cached) return;
    let cancelled = false;
    setIsComputing(true);
    setError(null);
    triggerSelect(address, customFilters)
      .then(() => {
        if (cancelled) return;
        setIsComputing(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e as Error);
        setIsComputing(false);
      });
    return () => {
      cancelled = true;
    };
    // customFilters is a fresh array on every render — caller should
    // memoise. We intentionally exclude it from deps to avoid re-trigger
    // on every render; address change + manual refresh are the trigger
    // points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const refresh = useCallback(() => {
    if (!address) return;
    invalidateAutoNominateCache();
    setIsComputing(true);
    setError(null);
    triggerSelect(address, customFilters)
      .then(() => setIsComputing(false))
      .catch((e) => {
        setError(e as Error);
        setIsComputing(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const result = address ? getCached(address) : null;

  // In prefetch mode the caller doesn't read the result, but we still
  // want to fire the fetch. The useEffect above does that.
  if (mode === 'prefetch') {
    return { result: null, isComputing: false, error: null, refresh };
  }

  return { result, isComputing, error, refresh };
}
