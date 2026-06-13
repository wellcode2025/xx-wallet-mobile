/**
 * Shared gateway for every xx foundation indexer query.
 *
 * Two jobs:
 *   1. One place for the GraphQL fetch boilerplate that was previously
 *      duplicated across seven files.
 *   2. The privacy gate: when the user turns the indexer off in
 *      Settings, every query refuses locally with IndexerDisabledError
 *      BEFORE any network request — nothing leaves the device. Callers
 *      catch that error type and render an honest degraded state
 *      ("enable the indexer in Settings to see history") or fall back
 *      to direct chain RPC where one exists (identity lookups).
 *
 * Why a gate and not just hiding UI: the queries reveal the user's
 * addresses and IP to the indexer operator. A privacy setting that
 * still leaks on some code path is worse than none, so the enforcement
 * lives at the single choke point all indexer traffic flows through.
 */

import { useSettingsStore } from '../store/settings';

export const INDEXER_URL = 'https://indexer.xx.network/v1/graphql';

/** Thrown (locally, before any network IO) when the indexer is off. */
export class IndexerDisabledError extends Error {
  constructor() {
    super('Indexer queries are disabled in Settings.');
    this.name = 'IndexerDisabledError';
  }
}

/** Current state of the privacy toggle, readable outside React. */
export function isIndexerEnabled(): boolean {
  return useSettingsStore.getState().indexerEnabled;
}

/** True when an error came from the privacy gate (not a network/HTTP
 *  failure) — screens special-case this into "enable the indexer in
 *  Settings" copy instead of a generic couldn't-load message. */
export function isIndexerDisabledError(e: unknown): boolean {
  return e instanceof Error && e.name === 'IndexerDisabledError';
}

/**
 * POST a GraphQL query to the indexer and return the `data` payload.
 *
 * Throws IndexerDisabledError when the toggle is off, a plain Error on
 * HTTP failure or GraphQL-level errors. Response shape validation stays
 * with the caller — schemas differ per query and the existing defensive
 * parsing is query-specific.
 */
export async function indexerQuery<TData>(
  query: string,
  variables?: Record<string, unknown>,
  operationName?: string
): Promise<TData> {
  if (!isIndexerEnabled()) {
    throw new IndexerDisabledError();
  }
  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      ...(variables ? { variables } : {}),
      ...(operationName ? { operationName } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Indexer request failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as {
    data?: TData;
    errors?: Array<{ message?: string }>;
  };
  if (json.errors?.length) {
    throw new Error(
      `Indexer query error: ${json.errors[0]?.message ?? 'unknown'}`
    );
  }
  if (json.data === undefined) {
    throw new Error('Indexer returned no data.');
  }
  return json.data;
}
