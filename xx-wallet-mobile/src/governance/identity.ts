/**
 * IdentityResolver — shared identity-resolution layer for governance UI.
 *
 * Wraps `src/api/identity.ts`'s `fetchIdentity` with three things every
 * governance screen needs but each component shouldn't have to re-implement:
 *
 *   1. **In-memory cache.** Council renders 13 members, Tech. comm. another 4,
 *      bounty list renders 9 curators + 9 proposers, and tech-comm members
 *      overlap fully with council. Without a shared cache a single screen
 *      load would fire 30+ identical RPC calls. The cache lives for the
 *      session — identity changes are rare enough that re-fetching on every
 *      reload would be wasteful for no observable freshness benefit.
 *
 *   2. **Promise coalescing.** If two components mount at the same time and
 *      both request identity for the same address, they share a single
 *      in-flight fetch rather than firing two parallel requests. The
 *      `pending` Map holds the unsettled Promise; both callers await it.
 *
 *   3. **React hook.** `useIdentity(address)` returns `{ identity, loading }`
 *      and triggers a fetch on mount if the address isn't already cached.
 *      Components can also call `resolveBatch(addresses)` directly when
 *      they know they'll need a list of identities up front (e.g. the
 *      Council members screen).
 *
 * Cache shape: `Map<address, OnChainIdentity | null>`. We cache nulls
 * (addresses with no on-chain identity) the same way we cache hits — a
 * miss is a fact about the chain, not a transient failure to be retried.
 *
 * Display-name helper: every governance screen needs the same "display
 * name OR shortened address" pattern (per  §7.3
 * — always pair the name with a truncated SS58 so a name swap cannot hide
 * what's being signed). `displayName(identity, address)` codifies it.
 */

import { useEffect, useState } from 'react';
import { fetchIdentity, fetchIdentitiesBatch } from '@/api';
import type { OnChainIdentity } from '@/store';
import { shortenAddress } from '@/utils/address';

/** Resolved value for an address. `null` means "queried but no identity set". */
type Resolved = OnChainIdentity | null;

const cache = new Map<string, Resolved>();
const pending = new Map<string, Promise<Resolved>>();

/**
 * Look up `address` in the cache without triggering a fetch.
 *
 * Returns `undefined` if not cached, `null` if cached as "no identity",
 * `OnChainIdentity` if cached as resolved. The three-state return lets
 * callers distinguish "we haven't asked yet" from "we asked and there's
 * nothing there".
 */
export function getCachedIdentity(address: string): Resolved | undefined {
  return cache.get(address);
}

/**
 * Resolve a single identity. Returns the cached value if present; otherwise
 * triggers a fetch (coalescing with any in-flight request for the same
 * address) and resolves to the result.
 */
export async function resolveIdentity(address: string): Promise<Resolved> {
  const cached = cache.get(address);
  if (cached !== undefined) return cached;
  const inFlight = pending.get(address);
  if (inFlight) return inFlight;

  const p = (async () => {
    try {
      const result = await fetchIdentity(address);
      cache.set(address, result);
      return result;
    } catch {
      // Fetch errors don't get cached — leave the address open for retry.
      // (A null result for a successful query DOES get cached above.)
      return null;
    } finally {
      pending.delete(address);
    }
  })();
  pending.set(address, p);
  return p;
}

/**
 * Resolve a batch of identities, hitting the cache wherever possible and
 * fetching only the addresses we don't already know. Delegates uncached
 * addresses to `fetchIdentitiesBatch` so we keep the indexer-batch
 * concurrency control there rather than duplicating it here.
 *
 * Returns the same Map shape as `fetchIdentitiesBatch`, covering every
 * input address (with values pulled from cache for already-resolved ones).
 */
export async function resolveIdentitiesBatch(
  addresses: string[]
): Promise<Map<string, Resolved>> {
  const result = new Map<string, Resolved>();
  const toFetch: string[] = [];
  for (const addr of addresses) {
    const cached = cache.get(addr);
    if (cached !== undefined) {
      result.set(addr, cached);
    } else if (!pending.has(addr)) {
      toFetch.push(addr);
    }
  }
  // Any address with an in-flight promise gets awaited individually below.
  if (toFetch.length > 0) {
    const fetched = await fetchIdentitiesBatch(toFetch);
    for (const [addr, val] of fetched) {
      cache.set(addr, val);
      result.set(addr, val);
    }
  }
  // Drain pending fetches for addresses we didn't include in toFetch but
  // whose result we still need to return.
  const stillPending = addresses.filter(
    (a) => !result.has(a) && pending.has(a)
  );
  await Promise.all(
    stillPending.map(async (a) => {
      const v = await pending.get(a)!;
      result.set(a, v);
    })
  );
  return result;
}

/**
 * React hook — returns the identity for `address` (re-renders when the
 * fetch settles). Pass `null`/`undefined` when the address isn't ready
 * yet (e.g. before a parent has loaded); the hook will short-circuit and
 * return `{ identity: null, loading: false }` without firing a fetch.
 */
export function useIdentity(
  address: string | null | undefined
): { identity: Resolved; loading: boolean } {
  // Initialise from cache synchronously when possible — avoids the brief
  // "loading flash" on every cached identity.
  const initial = address ? cache.get(address) : undefined;
  const [identity, setIdentity] = useState<Resolved>(
    initial !== undefined ? initial : null
  );
  const [loading, setLoading] = useState<boolean>(
    !!address && initial === undefined
  );

  useEffect(() => {
    if (!address) {
      setIdentity(null);
      setLoading(false);
      return;
    }
    const cached = cache.get(address);
    if (cached !== undefined) {
      setIdentity(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    resolveIdentity(address).then((v) => {
      if (cancelled) return;
      setIdentity(v);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return { identity, loading };
}

/**
 * Always-paired display: identity display name (when set) + truncated
 * SS58. Per  §7.3, the name MUST be paired
 * with the truncated address so identity registration cannot be used to
 * hide what's being signed. Use this everywhere council members /
 * curators / proposers are rendered.
 *
 * Returns the truncated address alone when no display name is set.
 */
export function displayName(
  identity: Resolved,
  address: string
): { primary: string; secondary: string } {
  const short = shortenAddress(address);
  if (identity?.display) {
    return { primary: identity.display, secondary: short };
  }
  return { primary: short, secondary: '' };
}

/**
 * Clear the in-memory cache. Test-only.
 */
export function __clearIdentityCacheForTests(): void {
  cache.clear();
  pending.clear();
}
