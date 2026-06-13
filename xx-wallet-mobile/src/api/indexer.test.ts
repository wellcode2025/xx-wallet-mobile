/**
 * Tests for the indexer privacy gate. The load-bearing claim: when the
 * user disables the indexer in Settings, indexerQuery refuses LOCALLY —
 * zero network IO — and the refusal is distinguishable from network
 * failures so screens can render honest "disabled in Settings" copy.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// In-memory localStorage shim for the zustand persist middleware (node
// test env has no DOM). Must exist before the settings store module
// evaluates.
beforeAll(() => {
  if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    };
  }
});

import {
  IndexerDisabledError,
  indexerQuery,
  isIndexerDisabledError,
  isIndexerEnabled,
} from './indexer';
import { useSettingsStore } from '../store/settings';

afterEach(() => {
  useSettingsStore.setState({ indexerEnabled: true });
  vi.unstubAllGlobals();
});

describe('indexer privacy gate', () => {
  it('defaults to enabled', () => {
    expect(isIndexerEnabled()).toBe(true);
  });

  it('refuses locally when disabled — fetch is NEVER called', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network IO attempted while indexer disabled');
    });
    vi.stubGlobal('fetch', fetchSpy);

    useSettingsStore.setState({ indexerEnabled: false });
    await expect(indexerQuery('query { x }')).rejects.toBeInstanceOf(
      IndexerDisabledError
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('queries normally when enabled', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { hello: 'world' } }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const data = await indexerQuery<{ hello: string }>('query { hello }');
    expect(data.hello).toBe('world');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('surfaces HTTP and GraphQL failures as plain errors (not the disabled type)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 }))
    );
    await expect(indexerQuery('query { x }')).rejects.toThrow(/HTTP 503/);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ errors: [{ message: 'bad field' }] }),
      }))
    );
    try {
      await indexerQuery('query { x }');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/bad field/);
      expect(isIndexerDisabledError(e)).toBe(false);
    }
  });

  it('isIndexerDisabledError discriminates correctly', () => {
    expect(isIndexerDisabledError(new IndexerDisabledError())).toBe(true);
    expect(isIndexerDisabledError(new Error('network down'))).toBe(false);
    expect(isIndexerDisabledError(null)).toBe(false);
    expect(isIndexerDisabledError('string')).toBe(false);
  });
});
