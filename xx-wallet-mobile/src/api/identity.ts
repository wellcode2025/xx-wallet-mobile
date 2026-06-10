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
 * Each flag reflects *current* on-chain role, not history. An ex-validator
 * who has chilled returns `validator: false`.
 *
 * NOTE: currently unused in production; kept as a seed for
 * read-only staking views and active staking.
 *
 * Confirmed against live xx network: these flags populate reliably for
 * known role-holders. An earlier version
 * of this code queried `where: { id: ... }` and silently 500'd because the
 * indexer's primary key is `account_id`; an earlier "data population isn't
 * reliable" note was an artifact of that schema-key bug. The
 * aggregate-table fallback that masked it was also semantically wrong (it
 * counted ever-was-a-validator, not currently-is) and has been removed.
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
    account(where: { account_id: { _eq: $address } }, limit: 1) {
      account_id
      identity {
        display
        legal
        email
        web
        twitter
        riot
        judgements
        __typename
      }
      __typename
    }
  }
`;

const ACCOUNT_ROLES_QUERY = `
  query GetAccountRoles($address: String!) {
    account(where: { account_id: { _eq: $address } }, limit: 1) {
      account_id
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
 * Fetch validator/nominator/council/techcommit/special role flags for an
 * address from the indexer. Returns null if the address has no row in the
 * account table (e.g. a genesis-only address that's never transacted) or
 * if the query fails.
 *
 * Currently exported but unused in production; read-only staking views
 * consume this for role badges. See AccountRoles for the currently-is vs
 * has-ever-been distinction and the rationale behind it.
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
      console.warn('Account roles query errors:', json.errors);
      return null;
    }

    const acct = json?.data?.account?.[0];
    if (!acct) return null;

    return {
      validator: acct.validator ?? false,
      nominator: acct.nominator ?? false,
      council: acct.council ?? false,
      techcommit: acct.techcommit ?? false,
      special: acct.special ?? null,
    };
  } catch (err) {
    console.warn('Account roles fetch failed:', err);
    return null;
  }
}

/**
 * Fetch the on-chain identity record for an address from the indexer.
 *
 * NOTE (2026-05-15): the indexer's `identity` type has no `judgement`
 * (singular) field — the real field is `judgements` (plural, a `json`
 * column with the Substrate Vec<(RegistrarIndex, Judgement)> shape).
 * An earlier fix-pass corrected the `id` → `account_id` schema-key bug
 * but left the singular `judgement` field selected, which kept this
 * function silently erroring (the query was invalid against the
 * indexer schema) and falling back to fetchIdentityFromChain. This
 * fix corrects the field name and parses the JSON-array judgements
 * defensively via extractJudgement.
 *
 * On xx network specifically `judgements` is always [] (no on-chain
 * registrar pallet) and `verified` is always false network-wide, so
 * the judgement field this function returns is always undefined here.
 * The parsing exists for parity with fetchIdentityFromChain on
 * Substrate chains that do have a registrar.
 */
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
    const judgement = extractJudgement(identity.judgements);
    if (judgement) cleaned.judgement = judgement;

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

/**
 * Parse the indexer's `identity.judgements` JSON column into a single
 * judgement-kind string, matching the shape fetchIdentityFromChain
 * produces. The column follows the Substrate identity pallet's
 * Vec<(RegistrarIndex, Judgement)> shape; we extract the kind of the
 * first entry, since OnChainIdentity.judgement is a single string.
 *
 * Returns undefined when there are no judgements — the universal case
 * on xx network (no on-chain registrar pallet, so the column is
 * always []). Defensive across several plausible JSON shapes since we
 * have no populated example on xx to nail down the canonical form.
 */
function extractJudgement(raw: unknown): string | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const first = raw[0];
  // Common Substrate-JSON encodings:
  //   "Reasonable"                  — just the kind
  //   [0, "Reasonable"]             — [registrar, kind]
  //   [0, {KnownGood: null}]        — [registrar, { kind: null }]
  //   { judgement: "Reasonable" }   — object with named field
  //   { kind: "Reasonable" }        — alt naming
  if (typeof first === 'string') return first;
  if (Array.isArray(first)) {
    const k = first[1];
    if (typeof k === 'string') return k;
    if (k && typeof k === 'object') return Object.keys(k)[0];
  }
  if (first && typeof first === 'object') {
    const obj = first as Record<string, unknown>;
    if (typeof obj.judgement === 'string') return obj.judgement;
    if (typeof obj.kind === 'string') return obj.kind;
  }
  return undefined;
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
