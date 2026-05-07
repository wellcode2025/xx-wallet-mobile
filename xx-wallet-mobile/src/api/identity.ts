/**
 * On-chain identity and account role fetcher.
 *
 * Fetches identity data from the xx foundation indexer (indexer.xx.network).
 * Identity fetching is only ever triggered by explicit user action —
 * never on background timers.
 */

import type { OnChainIdentity } from '@/store';
import { xxApi } from '@/api';

const INDEXER_URL = 'https://indexer.xx.network/v1/graphql';

/**
 * On-chain account roles as indexed by indexer.xx.network.
 *
 * NOTE (2026-05-04): currently unused in the UI. Kept as a seed for Phase 2b
 * (read-only staking views) and Phase 3 (active staking) per STRATEGY_UPDATE.
 * The indexer's `account` table direct queries for these fields returned empty
 * during Phase 1 attempts (HANDOFF Section 9) — the schema is correct, the
 * data population isn't reliable yet, which is why this is a seed rather than
 * a working feature. Revisit when Phase 2b starts; we'll be deep in the same
 * indexer surface anyway. Do not delete without re-validating that staking
 * role detection is unneeded.
 */
export interface AccountRoles {
  validator: boolean;
  nominator: boolean;
  council: boolean;
  techcommit: boolean;
  /** "bridge", "custodian", etc. — special system accounts */
  special: string | null;
}

const ACCOUNT_IDENTITY_QUERY = `
  query GetAccountIdentity($address: String!) {
    account(where: { id: { _eq: $address } }, limit: 1) {
      id
      identity {
        display
        legal
        email
        web
        twitter
        riot
        judgement
        __typename
      }
      __typename
    }
  }
`;

const ACCOUNT_ROLES_QUERY = `
  query GetAccountRoles($address: String!) {
    nominatorCount: nominator_stats_aggregate(
      where: { stash_address: { _eq: $address } }
    ) {
      aggregate { count __typename }
      __typename
    }
    validatorCount: validator_stats_aggregate(
      where: { stash_address: { _eq: $address } }
    ) {
      aggregate { count __typename }
      __typename
    }
    accountInfo: account(
      where: { id: { _eq: $address } }
      limit: 1
    ) {
      id
      validator
      nominator
      council
      techcommit
      special
      __typename
    }
  }
`;

/**
 * Fetch validator/nominator/council/etc. role flags for an address from the
 * indexer. Currently exported but unused — see the AccountRoles interface
 * comment above for the phase context. When Phase 2b lands, the role-badge
 * UI will consume this; the fallback path that derives roles from the
 * staking aggregate tables is here because the direct `account.validator`
 * etc. columns weren't reliable in Phase 1.
 */
export async function fetchAccountRoles(address: string): Promise<AccountRoles | null> {
  try {
    const response = await fetch(INDEXER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'GetAccountRoles',
        query: ACCOUNT_ROLES_QUERY,
        variables: { address },
      }),
    });
    if (!response.ok) return null;
    const json = await response.json();

    if (json.errors) {
      console.warn('Account roles query errors (partial):', json.errors);
    }

    const data = json?.data;
    if (!data) return null;

    // Try the direct account table first — most accurate
    const acct = data.accountInfo?.[0];
    if (acct) {
      return {
        validator: acct.validator ?? false,
        nominator: acct.nominator ?? false,
        council: acct.council ?? false,
        techcommit: acct.techcommit ?? false,
        special: acct.special ?? null,
      };
    }

    // Fall back: derive roles from staking tables we know work
    const nominatorCount = Number(data.nominatorCount?.aggregate?.count ?? 0);
    const validatorCount = Number(data.validatorCount?.aggregate?.count ?? 0);

    return {
      validator: validatorCount > 0,
      nominator: nominatorCount > 0,
      council: false,
      techcommit: false,
      special: null,
    };
  } catch (err) {
    console.warn('Account roles fetch failed:', err);
    return null;
  }
}

export async function fetchIdentityFromIndexer(
  address: string
): Promise<OnChainIdentity | null> {
  try {
    const response = await fetch(INDEXER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'GetAccountIdentity',
        query: ACCOUNT_IDENTITY_QUERY,
        variables: { address },
      }),
    });
    if (!response.ok) return null;
    const json = await response.json();
    if (json.errors) {
      console.warn('Indexer identity query errors:', json.errors);
      return null;
    }
    const identity = json?.data?.account?.[0]?.identity;
    if (!identity) return null;

    const cleaned: OnChainIdentity = { fetchedAt: Date.now() };
    if (identity.display) cleaned.display = identity.display;
    if (identity.legal) cleaned.legal = identity.legal;
    if (identity.email) cleaned.email = identity.email;
    if (identity.web) cleaned.web = identity.web;
    if (identity.twitter) cleaned.twitter = identity.twitter;
    if (identity.riot) cleaned.riot = identity.riot;
    if (identity.judgement) cleaned.judgement = identity.judgement;

    const hasAnyField = Object.keys(cleaned).length > 1;
    return hasAnyField ? cleaned : null;
  } catch (err) {
    console.warn('Indexer identity fetch failed:', err);
    return null;
  }
}

export async function fetchIdentityFromChain(
  address: string
): Promise<OnChainIdentity | null> {
  try {
    const api = await xxApi.getApi();
    if (!api.query.identity?.identityOf) return null;

    const result = await api.query.identity.identityOf(address);
    if (!result || (result as any).isEmpty || (result as any).isNone) return null;

    const raw = (result as any).toJSON ? (result as any).toJSON() : null;
    if (!raw) return null;

    const reg = Array.isArray(raw) ? raw[0] : raw;
    if (!reg?.info) return null;

    const info = reg.info;
    const decodeField = (field: any): string | undefined => {
      if (!field) return undefined;
      if (field.raw) return typeof field.raw === 'string' ? hexToString(field.raw) : undefined;
      return undefined;
    };

    let judgement: string | undefined;
    if (Array.isArray(reg.judgements) && reg.judgements.length > 0) {
      for (const [, kind] of reg.judgements) {
        if (typeof kind === 'string') { judgement = kind; break; }
        if (kind && typeof kind === 'object') { judgement = Object.keys(kind)[0]; break; }
      }
    }

    const cleaned: OnChainIdentity = {
      fetchedAt: Date.now(),
      display: decodeField(info.display),
      legal: decodeField(info.legal),
      email: decodeField(info.email),
      web: decodeField(info.web),
      twitter: decodeField(info.twitter),
      riot: decodeField(info.riot),
      judgement,
    };

    for (const key of Object.keys(cleaned) as Array<keyof OnChainIdentity>) {
      if (cleaned[key] === undefined) delete cleaned[key];
    }

    const hasAnyField = Object.keys(cleaned).length > 1;
    return hasAnyField ? cleaned : null;
  } catch (err) {
    console.warn('Chain identity fetch failed:', err);
    return null;
  }
}

export async function fetchIdentity(
  address: string
): Promise<OnChainIdentity | null> {
  const fromIndexer = await fetchIdentityFromIndexer(address);
  if (fromIndexer) return fromIndexer;
  return fetchIdentityFromChain(address);
}

export async function fetchIdentitiesBatch(
  addresses: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, OnChainIdentity | null>> {
  const result = new Map<string, OnChainIdentity | null>();
  const CONCURRENCY = 4;
  let index = 0;
  let completed = 0;

  async function worker() {
    while (index < addresses.length) {
      const myIndex = index++;
      const addr = addresses[myIndex];
      try {
        result.set(addr, await fetchIdentity(addr));
      } catch {
        result.set(addr, null);
      }
      completed++;
      onProgress?.(completed, addresses.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, addresses.length) }, () => worker())
  );
  return result;
}

function hexToString(hex: string): string | undefined {
  try {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length === 0) return undefined;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.substr(i, 2), 16);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return undefined;
  }
}
