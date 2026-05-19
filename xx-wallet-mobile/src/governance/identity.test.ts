/**
 * Tests for the IdentityResolver caching + coalescing layer.
 *
 * What we cover:
 *   - displayName: pure-function pairing rule (§7.3 of multisig design)
 *   - cache hit: a second resolve doesn't re-call fetchIdentity
 *   - cache miss caching: a null result is cached and doesn't re-fetch
 *   - promise coalescing: two simultaneous resolves share one fetch
 *   - error path: a thrown fetch doesn't pollute the cache
 *   - batch: uses the cache for hits, fetches only misses
 *
 * The React `useIdentity` hook isn't covered here — that would need
 * React Testing Library which isn't in deps. Hook is a thin wrapper
 * over the same coalescing primitives this file exercises.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

// Mock the underlying api fetchers BEFORE importing the module under test.
vi.mock('@/api', () => ({
  fetchIdentity: vi.fn(),
  fetchIdentitiesBatch: vi.fn(),
}));

import { fetchIdentity, fetchIdentitiesBatch } from '@/api';
import {
  __clearIdentityCacheForTests,
  displayName,
  getCachedIdentity,
  resolveIdentitiesBatch,
  resolveIdentity,
} from './identity';

const ALICE = '6VaNn3ntdFWQWysscqt2bxDtqKBkeKqFvnzgYATQAytefTVT';
const BOB = '6Vcqq5SoUTRY2ZZ361BVfASa9RGkYiAa7Pj17qjMCoLCyDd4';
const CHARLIE = '6WSH4iFzYY3ATabSuQwSaaacFLs9JVAhH7R3xAFf1UyWoEsH';

const fetchIdentityMock = vi.mocked(fetchIdentity);
const fetchIdentitiesBatchMock = vi.mocked(fetchIdentitiesBatch);

beforeEach(() => {
  __clearIdentityCacheForTests();
  fetchIdentityMock.mockReset();
  fetchIdentitiesBatchMock.mockReset();
});

describe('displayName', () => {
  it('pairs the display name with a truncated address when set', () => {
    const r = displayName(
      { display: 'ROBBIE', fetchedAt: 1 },
      '6WhoHGAWQHZUGoYew3KwA18pEPVBmzLnfbhZmXp5oEqMouJf'
    );
    expect(r.primary).toBe('ROBBIE');
    // shortenAddress defaults: 5 leading chars + 4 trailing
    expect(r.secondary).toBe('6WhoH…ouJf');
  });

  it('falls back to the truncated address alone when no identity set', () => {
    const r = displayName(null, ALICE);
    expect(r.primary).toBe('6VaNn…fTVT');
    expect(r.secondary).toBe('');
  });

  it('uses the truncated address when identity has no display field', () => {
    const r = displayName(
      { legal: 'Some Legal Name', fetchedAt: 1 },
      ALICE
    );
    expect(r.primary).toBe('6VaNn…fTVT');
    expect(r.secondary).toBe('');
  });
});

describe('resolveIdentity — caching', () => {
  it('returns undefined from getCachedIdentity before any fetch', () => {
    expect(getCachedIdentity(ALICE)).toBeUndefined();
  });

  it('caches a successful resolve so the second call does not refetch', async () => {
    fetchIdentityMock.mockResolvedValue({
      display: 'ALICE',
      fetchedAt: 100,
    });
    const first = await resolveIdentity(ALICE);
    const second = await resolveIdentity(ALICE);
    expect(first?.display).toBe('ALICE');
    expect(second?.display).toBe('ALICE');
    expect(fetchIdentityMock).toHaveBeenCalledTimes(1);
  });

  it('caches a null result the same way as a hit', async () => {
    fetchIdentityMock.mockResolvedValue(null);
    const first = await resolveIdentity(BOB);
    const second = await resolveIdentity(BOB);
    expect(first).toBeNull();
    expect(second).toBeNull();
    // getCachedIdentity distinguishes "not asked" (undefined) from
    // "asked and got null" (null) — load-bearing for ui logic.
    expect(getCachedIdentity(BOB)).toBeNull();
    expect(fetchIdentityMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveIdentity — promise coalescing', () => {
  it('shares a single in-flight fetch between simultaneous callers', async () => {
    let resolveFetch!: (v: any) => void;
    fetchIdentityMock.mockImplementation(
      () => new Promise((res) => {
        resolveFetch = res;
      })
    );
    const a = resolveIdentity(CHARLIE);
    const b = resolveIdentity(CHARLIE);
    expect(fetchIdentityMock).toHaveBeenCalledTimes(1);
    resolveFetch({ display: 'KEITH', fetchedAt: 200 });
    const [va, vb] = await Promise.all([a, b]);
    expect(va?.display).toBe('KEITH');
    expect(vb?.display).toBe('KEITH');
    // Still only one underlying fetch.
    expect(fetchIdentityMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveIdentity — error path', () => {
  it('does not cache a thrown fetch, allowing retry', async () => {
    fetchIdentityMock.mockRejectedValueOnce(new Error('network blip'));
    fetchIdentityMock.mockResolvedValueOnce({
      display: 'RETRIED',
      fetchedAt: 300,
    });
    const first = await resolveIdentity(ALICE);
    expect(first).toBeNull(); // error path returns null without caching
    // Cache should NOT contain a value for ALICE after the error.
    expect(getCachedIdentity(ALICE)).toBeUndefined();
    const second = await resolveIdentity(ALICE);
    expect(second?.display).toBe('RETRIED');
    expect(fetchIdentityMock).toHaveBeenCalledTimes(2);
  });
});

describe('resolveIdentitiesBatch', () => {
  it('uses cache for already-resolved addresses and only fetches the rest', async () => {
    // Pre-seed cache with ALICE via a single fetch
    fetchIdentityMock.mockResolvedValueOnce({
      display: 'ALICE',
      fetchedAt: 100,
    });
    await resolveIdentity(ALICE);
    expect(fetchIdentityMock).toHaveBeenCalledTimes(1);

    // Now batch over ALICE + BOB + CHARLIE — only BOB + CHARLIE should
    // hit the batch endpoint, ALICE should come from cache.
    fetchIdentitiesBatchMock.mockResolvedValueOnce(
      new Map([
        [BOB, { display: 'BERNIE', fetchedAt: 200 }],
        [CHARLIE, null],
      ])
    );
    const result = await resolveIdentitiesBatch([ALICE, BOB, CHARLIE]);
    expect(result.get(ALICE)?.display).toBe('ALICE');
    expect(result.get(BOB)?.display).toBe('BERNIE');
    expect(result.get(CHARLIE)).toBeNull();
    // The batch endpoint was called with only the uncached addresses.
    expect(fetchIdentitiesBatchMock).toHaveBeenCalledTimes(1);
    const callArg = fetchIdentitiesBatchMock.mock.calls[0][0];
    expect(callArg).toEqual([BOB, CHARLIE]);
  });

  it('returns an empty map slot for an address that resolves to null', async () => {
    fetchIdentitiesBatchMock.mockResolvedValueOnce(
      new Map([[ALICE, null]])
    );
    const result = await resolveIdentitiesBatch([ALICE]);
    expect(result.get(ALICE)).toBeNull();
    expect(getCachedIdentity(ALICE)).toBeNull();
  });

  it('does not re-fetch addresses that are in-flight from a parallel resolveIdentity', async () => {
    let releaseSingle!: (v: any) => void;
    fetchIdentityMock.mockImplementationOnce(
      () => new Promise((res) => {
        releaseSingle = res;
      })
    );
    // Start a single resolve — leaves an in-flight promise for ALICE.
    const single = resolveIdentity(ALICE);
    // While that's in flight, request a batch including ALICE.
    fetchIdentitiesBatchMock.mockResolvedValueOnce(
      new Map([[BOB, { display: 'BERNIE', fetchedAt: 200 }]])
    );
    const batchPromise = resolveIdentitiesBatch([ALICE, BOB]);
    // Release the single resolve.
    releaseSingle({ display: 'ALICE', fetchedAt: 100 });
    const [singleResult, batchResult] = await Promise.all([single, batchPromise]);
    expect(singleResult?.display).toBe('ALICE');
    expect(batchResult.get(ALICE)?.display).toBe('ALICE');
    expect(batchResult.get(BOB)?.display).toBe('BERNIE');
    // Batch fetch was called with only BOB; ALICE rode the in-flight promise.
    const batchArg = fetchIdentitiesBatchMock.mock.calls[0][0];
    expect(batchArg).toEqual([BOB]);
  });
});
