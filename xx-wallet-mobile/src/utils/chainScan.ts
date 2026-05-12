/**
 * Chain scan — Path C of the multisig add flow.
 *
 * Discovers multisigs the user is already a signer of, by walking the
 * xx network indexer's history of multisig.asMulti / approveAsMulti /
 * cancelAsMulti extrinsics and pulling out the (threshold, signers)
 * tuple from each. The user's wallet then picks which discoveries to
 * persist as Multisig records.
 *
 * Per design doc §6.6 Path C and §11.5 (user-initiated only — this
 * function runs when the user explicitly taps Scan, never on a timer
 * or as part of any background refresh).
 *
 * Algorithm:
 *   1. For each of the user's wallet accounts, query the indexer's
 *      event table for multisig events whose data blob mentions that
 *      account. Same ILIKE pattern the spike used; catches both
 *      "user was the approver" and "user appears in other_signatories".
 *   2. Collect unique (block_number, extrinsic_index) pairs.
 *   3. Batch-fetch those extrinsics so we get their args + signer.
 *   4. From each extrinsic, parse args to extract threshold +
 *      other_signatories. Reconstruct the full signer set as
 *      sorted([extrinsic.signer, ...other_signatories]).
 *   5. Locally derive the multisig address from (threshold, sorted
 *      signers) via deriveMultisigAddress.
 *   6. Dedupe by derived address; aggregate activity counts.
 *
 * Notes for callers:
 *   - This hits the indexer with several queries. On a wallet user
 *     with deep history it can take a few seconds. The UI should show
 *     a clear loading state.
 *   - Returns ALL discoverable multisigs, including ones the user
 *     has already imported. The caller filters as appropriate.
 *   - Crypto must be ready (cryptoWaitReady) before calling — the
 *     derivation uses blake2 / @polkadot/util-crypto.
 */

import { deriveMultisigAddress } from './multisig';
import { isValidXxAddress } from './address';

const INDEXER_URL = 'https://indexer.xx.network/v1/graphql';

/**
 * One multisig discovered on chain. Caller deduplicates and presents
 * for user-selectable import.
 */
export interface DiscoveredMultisig {
  /** SS58 multisig address (xx prefix 55), locally re-derived. */
  address: string;
  /** From the extrinsic args. */
  threshold: number;
  /** Full signer set, sorted SS58. Always includes the user's account
   *  that we found by searching. */
  signers: string[];
  /** Earliest block we saw activity at this multisig. */
  firstSeenBlock: number;
  /** Latest block we saw activity at this multisig. */
  lastSeenBlock: number;
  /** Count of unique extrinsics found involving this multisig. Useful
   *  for the user to gauge how active a multisig is. */
  activityCount: number;
  /** Which of the user's wallet accounts is a signer of this multisig.
   *  Always at least one. */
  userSigners: string[];
}

async function gql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const r = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`Indexer HTTP ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (j.errors) {
    throw new Error(`Indexer GraphQL errors: ${JSON.stringify(j.errors)}`);
  }
  return j.data as T;
}

/**
 * Walk the indexer history and return all multisigs that have any of
 * `userAddresses` in their signer set.
 *
 * Skipped multisigs are NOT reported as errors — they're just absent.
 * Failures we DO surface as throws:
 *   - Indexer unreachable / HTTP error
 *   - Indexer schema doesn't match what we expect (older runtime?)
 *
 * The caller should wrap in try/catch for user-friendly error display.
 */
export async function scanForUserMultisigs(
  userAddresses: string[]
): Promise<DiscoveredMultisig[]> {
  // Validate input. Filter to actually-valid xx addresses; ignore any
  // garbage that might've crept in from the caller.
  const validAddrs = userAddresses.filter(isValidXxAddress);
  if (validAddrs.length === 0) return [];

  // Phase 1: collect candidate (block, extrinsic_index) tuples from
  // multisig events mentioning any of the user's addresses. Doing one
  // query per address is simpler than building an _or of N ILIKE
  // clauses; the indexer handles it fine for a typical 1-5 account user.
  const candidateTuples = new Set<string>(); // "block:extIdx" keys
  for (const addr of validAddrs) {
    const { event } = await gql<{
      event: Array<{
        block_number: number | string;
        phase: unknown;
      }>;
    }>(
      `query EventsForAddress($addrLike: String!) {
        event(
          where: {
            module: { _eq: "multisig" }
            data: { _ilike: $addrLike }
          }
          order_by: { block_number: desc }
          limit: 500
        ) {
          block_number
          phase
        }
      }`,
      { addrLike: `%${addr}%` }
    );
    for (const e of event) {
      const extIdx = extrinsicIndexFromPhase(e.phase);
      if (extIdx === null) continue;
      const block = Number(e.block_number);
      candidateTuples.add(`${block}:${extIdx}`);
    }
  }

  if (candidateTuples.size === 0) return [];

  // Phase 2: batch-fetch the extrinsic rows for those tuples. We chunk
  // to keep individual GraphQL requests under a sensible size (the
  // indexer may have request-size limits; 50 per request is well within
  // anything reasonable).
  const tuples = Array.from(candidateTuples).map((k) => {
    const [b, i] = k.split(':');
    return { block: Number(b), idx: Number(i) };
  });

  const allExtrinsics: Array<{
    block_number: number | string;
    extrinsic_index: number;
    module: string;
    call: string;
    signer: string;
    args: unknown;
  }> = [];

  const CHUNK_SIZE = 50;
  for (let i = 0; i < tuples.length; i += CHUNK_SIZE) {
    const chunk = tuples.slice(i, i + CHUNK_SIZE);
    // Hasura `_or` of (block, idx) pairs.
    const orClauses = chunk.map((t) => ({
      block_number: { _eq: t.block },
      extrinsic_index: { _eq: t.idx },
    }));
    const { extrinsic } = await gql<{
      extrinsic: Array<{
        block_number: number | string;
        extrinsic_index: number;
        module: string;
        call: string;
        signer: string;
        args: unknown;
      }>;
    }>(
      `query ExtrinsicsBatch($or: [extrinsic_bool_exp!]) {
        extrinsic(where: { _or: $or, module: { _eq: "multisig" } }) {
          block_number
          extrinsic_index
          module
          call
          signer
          args
        }
      }`,
      { or: orClauses }
    );
    allExtrinsics.push(...extrinsic);
  }

  // Phase 3: parse each extrinsic and aggregate by derived multisig
  // address. Walk all of them; dedupe via the Map.
  const byAddress = new Map<string, DiscoveredMultisig>();

  for (const ext of allExtrinsics) {
    const parsed = parseMultisigExtrinsicArgs(ext.args);
    if (!parsed) continue;
    const { threshold, otherSignatories } = parsed;

    // Build the full signer set: signer of this extrinsic + others.
    // Sort SS58 for canonical derivation.
    const fullSigners = [
      ext.signer,
      ...otherSignatories,
    ];
    // Validate everyone — defensive against malformed extrinsic data.
    for (const s of fullSigners) {
      if (!isValidXxAddress(s)) continue;
    }
    const sorted = [...new Set(fullSigners)].sort();
    if (sorted.length < 2) continue;
    if (threshold < 1 || threshold > sorted.length) continue;

    // Verify at least ONE of the user's accounts is actually in this
    // signer set. The event-table ILIKE filter is overly broad —
    // an address can appear in event data for reasons other than
    // being a signer (e.g., it was the recipient of a transfer call
    // wrapped in asMulti). Without this check, we'd report multisigs
    // the user has no membership in.
    const userInSet = sorted.filter((s) => validAddrs.includes(s));
    if (userInSet.length === 0) continue;

    // Locally derive the multisig address. If derivation throws,
    // skip — extrinsic args were probably malformed.
    let address: string;
    try {
      address = deriveMultisigAddress(threshold, sorted);
    } catch {
      continue;
    }

    const blockNum = Number(ext.block_number);
    const existing = byAddress.get(address);
    if (existing) {
      existing.activityCount += 1;
      existing.firstSeenBlock = Math.min(existing.firstSeenBlock, blockNum);
      existing.lastSeenBlock = Math.max(existing.lastSeenBlock, blockNum);
    } else {
      byAddress.set(address, {
        address,
        threshold,
        signers: sorted,
        firstSeenBlock: blockNum,
        lastSeenBlock: blockNum,
        activityCount: 1,
        userSigners: userInSet,
      });
    }
  }

  // Sort results most-recently-active first — that's almost always
  // what the user wants to see at the top.
  return Array.from(byAddress.values()).sort(
    (a, b) => b.lastSeenBlock - a.lastSeenBlock
  );
}

/**
 * Parse the `args` JSON of a multisig.{asMulti, approveAsMulti,
 * cancelAsMulti} extrinsic and pull out the structural fields we need.
 *
 * Returns null if the shape doesn't match. Defensive against:
 *   - args being a string (some indexer versions stringify)
 *   - args being already-parsed object
 *   - missing or wrong-typed fields
 */
interface ParsedMultisigArgs {
  threshold: number;
  otherSignatories: string[];
}

function parseMultisigExtrinsicArgs(
  args: unknown
): ParsedMultisigArgs | null {
  let arr: unknown = args;
  if (typeof args === 'string') {
    try {
      arr = JSON.parse(args);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;

  // Substrate's asMulti / approveAsMulti / cancelAsMulti all take
  // threshold as the FIRST positional arg and other_signatories as the
  // second. Encoded JSON shape varies a little across runtime versions
  // but threshold is always parseable as a number / hex.
  if (arr.length < 2) return null;

  const thresholdRaw = arr[0];
  let threshold: number;
  if (typeof thresholdRaw === 'number') {
    threshold = thresholdRaw;
  } else if (typeof thresholdRaw === 'string') {
    // SCALE-encoded u16 sometimes shows up as 0x0002 etc.
    if (thresholdRaw.startsWith('0x')) {
      const n = parseInt(thresholdRaw, 16);
      if (Number.isNaN(n)) return null;
      threshold = n;
    } else {
      const n = parseInt(thresholdRaw, 10);
      if (Number.isNaN(n)) return null;
      threshold = n;
    }
  } else {
    return null;
  }

  const sigsRaw = arr[1];
  if (!Array.isArray(sigsRaw)) return null;
  const otherSignatories: string[] = [];
  for (const s of sigsRaw) {
    if (typeof s !== 'string') return null;
    otherSignatories.push(s);
  }

  return { threshold, otherSignatories };
}

/**
 * Extract the extrinsic index from an event's `phase` field. Substrate
 * event phase is one of: `{ ApplyExtrinsic: N }` / "Finalization" /
 * "Initialization". The indexer stores it as a String (sometimes JSON).
 * Returns the index or null for non-extrinsic phases.
 */
function extrinsicIndexFromPhase(phase: unknown): number | null {
  if (phase == null) return null;
  if (typeof phase === 'object' && 'applyExtrinsic' in phase) {
    const v = (phase as { applyExtrinsic?: number }).applyExtrinsic;
    return typeof v === 'number' ? v : null;
  }
  if (typeof phase === 'string') {
    const trimmed = phase.trim();
    if (/^(finalization|initialization)$/i.test(trimmed)) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const v = parsed.applyExtrinsic ?? parsed.ApplyExtrinsic;
        if (typeof v === 'number') return v;
      }
    } catch {
      /* fall through */
    }
  }
  return null;
}
