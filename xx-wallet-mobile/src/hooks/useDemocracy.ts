/**
 * useDemocracy — overview state for /governance/democracy.
 *
 * Surfaces every Gov1 democracy field the official xx web wallet shows
 * on its Democracy Overview page:
 *
 *   - referenda: count, list of currently-ongoing (decoded)
 *   - proposals: count, live public proposals (preimage-hash + depositor)
 *   - external: any pending external proposal (council-routed)
 *   - period constants (launchPeriod, votingPeriod, enactmentPeriod)
 *
 * One-shot fetch on mount. The launch-period countdown re-renders off
 * the connection store's blockNumber subscription. Currently-empty
 * sections (which is all of them at observation) drive empty-state UX.
 *
 * Scanning bound: only the window [lowestUnbaked..referendumCount) can
 * contain active referenda; everything below lowestUnbaked has been
 * baked or cancelled. We cap the scan at 64 ids defensively — if the
 * window is ever larger we'll log and surface the cap, but in practice
 * the chain is small.
 */

import { useEffect, useState } from 'react';
import type { BN } from '@polkadot/util';
import { xxApi } from '@/api';

const SCAN_CAP = 64;

export interface DemocracyTally {
  ayes: BN;
  nays: BN;
  turnout: BN;
}

export interface OngoingReferendum {
  /** Referendum index. */
  id: number;
  /** Block at which voting ends. */
  end: number;
  /** Blocks delay between approval and enactment. */
  delay: number;
  /** Vote-threshold variant: SuperMajorityApprove / SuperMajorityAgainst / SimpleMajority. */
  threshold: string;
  /** Current tally. */
  tally: DemocracyTally;
  /** Hash of the preimage this referendum will execute. May be empty for bounded inline calls. */
  proposalHash: string | null;
}

export interface PublicProposal {
  /** Index in publicPropCount-tracked sequence. */
  id: number;
  /** Depositor — original proposer. */
  depositor: string;
  /** Hash of the preimage this proposal targets. */
  proposalHash: string | null;
}

export interface ExternalProposal {
  /** Hash of the preimage. */
  proposalHash: string | null;
  /** Threshold variant the external is being introduced under. */
  threshold: string;
}

export interface DemocracyPeriods {
  /** Launch period in blocks — how often a new public referendum can launch. */
  launchPeriod: number;
  /** Voting period in blocks. */
  votingPeriod: number;
  /** Enactment delay in blocks for passed referenda. */
  enactmentPeriod: number;
  /** Minimum deposit (in planck) for proposing a referendum. */
  minimumDeposit: BN | null;
}

interface UseDemocracyResult {
  /** Historical total of all referenda ever opened. */
  referendumCount: number;
  /** Lowest referendum index that may still be ongoing. */
  lowestUnbaked: number;
  /** Currently-ongoing referenda (subset of [lowestUnbaked..referendumCount)). */
  ongoing: OngoingReferendum[];
  /** Historical total of all public proposals ever made. */
  publicPropCount: number;
  /** Currently-open public proposals. */
  publicProposals: PublicProposal[];
  /** External proposal (set by council), if any. */
  externalProposal: ExternalProposal | null;
  /** Period constants from chain. */
  periods: DemocracyPeriods;
  /** True iff the active-referendum scan was capped and may have missed entries. */
  scanCapHit: boolean;
  isLoading: boolean;
  error: Error | null;
}

const EMPTY_PERIODS: DemocracyPeriods = {
  launchPeriod: 0,
  votingPeriod: 0,
  enactmentPeriod: 0,
  minimumDeposit: null,
};

export function useDemocracy(): UseDemocracyResult {
  const [state, setState] = useState<UseDemocracyResult>({
    referendumCount: 0,
    lowestUnbaked: 0,
    ongoing: [],
    publicPropCount: 0,
    publicProposals: [],
    externalProposal: null,
    periods: EMPTY_PERIODS,
    scanCapHit: false,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true, error: null }));

    (async () => {
      try {
        const api = await xxApi.getApi();
        if (cancelled) return;

        const consts: any = api.consts.democracy ?? {};
        const periods: DemocracyPeriods = {
          launchPeriod: numFromConst(consts.launchPeriod),
          votingPeriod: numFromConst(consts.votingPeriod),
          enactmentPeriod: numFromConst(consts.enactmentPeriod),
          minimumDeposit: consts.minimumDeposit
            ? consts.minimumDeposit.toBn()
            : null,
        };

        const [refCountCodec, lowestUnbakedCodec, propCountCodec, publicPropsCodec, nextExternalCodec] =
          await Promise.all([
            api.query.democracy.referendumCount(),
            api.query.democracy.lowestUnbaked
              ? (api.query.democracy as any).lowestUnbaked()
              : Promise.resolve(null),
            api.query.democracy.publicPropCount(),
            api.query.democracy.publicProps(),
            (api.query.democracy as any).nextExternal?.().catch(() => null) ??
              Promise.resolve(null),
          ]);
        if (cancelled) return;

        const referendumCount = (refCountCodec as any).toNumber();
        const lowestUnbaked = lowestUnbakedCodec
          ? (lowestUnbakedCodec as any).toNumber()
          : 0;
        const publicPropCount = (propCountCodec as any).toNumber();

        // Active-referenda scan — bounded.
        const windowSize = referendumCount - lowestUnbaked;
        const scanLimit = Math.min(windowSize, SCAN_CAP);
        const scanCapHit = windowSize > SCAN_CAP;
        const candidates: number[] = [];
        for (let i = 0; i < scanLimit; i++) candidates.push(lowestUnbaked + i);
        const infos = await Promise.all(
          candidates.map((idx) => api.query.democracy.referendumInfoOf(idx))
        );
        if (cancelled) return;

        const ongoing: OngoingReferendum[] = [];
        for (let i = 0; i < candidates.length; i++) {
          const idx = candidates[i];
          const info: any = infos[i];
          if (!info?.isSome) continue;
          const inner = info.unwrap();
          if (!inner.isOngoing) continue;
          const ongoingData = inner.asOngoing;
          const proposalHashStr = extractProposalHash(ongoingData);
          ongoing.push({
            id: idx,
            end: ongoingData.end.toNumber(),
            delay: ongoingData.delay.toNumber(),
            threshold: ongoingData.threshold.toString(),
            tally: {
              ayes: ongoingData.tally.ayes.toBn(),
              nays: ongoingData.tally.nays.toBn(),
              turnout: ongoingData.tally.turnout.toBn(),
            },
            proposalHash: proposalHashStr,
          });
        }

        // Public proposals — Vec<(PropIndex, Hash | Bounded<Call>, AccountId)>.
        const publicProposals: PublicProposal[] = [];
        for (const entry of publicPropsCodec as any) {
          try {
            // entry is a 3-tuple. Different runtimes encode the middle element
            // as either a raw Hash or a `Bounded` enum wrapping one.
            const [idxCodec, hashCodecOrBounded, depositorCodec] = entry;
            const id = (idxCodec as any).toNumber();
            const depositor = (depositorCodec as any).toString();
            const proposalHash = extractProposalHash(hashCodecOrBounded);
            publicProposals.push({ id, depositor, proposalHash });
          } catch {
            /* skip malformed entry */
          }
        }

        let externalProposal: ExternalProposal | null = null;
        if (nextExternalCodec && (nextExternalCodec as any).isSome) {
          try {
            const [proposalCodec, thresholdCodec] = (nextExternalCodec as any).unwrap();
            externalProposal = {
              proposalHash: extractProposalHash(proposalCodec),
              threshold: thresholdCodec.toString(),
            };
          } catch {
            /* leave null */
          }
        }

        if (cancelled) return;
        setState({
          referendumCount,
          lowestUnbaked,
          ongoing,
          publicPropCount,
          publicProposals,
          externalProposal,
          periods,
          scanCapHit,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err as Error,
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function numFromConst(c: any): number {
  if (c == null) return 0;
  if (typeof c.toNumber === 'function') return c.toNumber();
  return Number(c.toString());
}

/**
 * Extract a hex proposal-hash string from one of the several wrappers
 * the chain may use:
 *   - Raw H256 (`.toHex()`)
 *   - `Bounded::Legacy { hash }` enum variant
 *   - `Bounded::Lookup { hash }` enum variant
 *   - `Bounded::Inline(bytes)` — the inline-call variant has no hash to
 *     show; returns null in that case.
 *
 * The wallet renders the hash for tap-through / explorer linking. Inline
 * variants are rare on xx Gov1 and we just surface "(inline call)" in UI.
 */
export function extractProposalHash(codec: any): string | null {
  if (codec == null) return null;
  try {
    // Direct H256 has toHex.
    if (typeof codec.toHex === 'function' && codec.constructor?.name?.includes('H256')) {
      return codec.toHex();
    }
    // FrameSupportPreimagesBounded — discriminated union.
    if (codec.isLegacy || codec.isLookup || codec.isInline) {
      if (codec.isLegacy) {
        const inner = codec.asLegacy;
        return (inner.hash_ ?? inner.hash).toHex();
      }
      if (codec.isLookup) {
        const inner = codec.asLookup;
        return (inner.hash_ ?? inner.hash).toHex();
      }
      // Inline — no separate hash; could blake2 the inline bytes but that's
      // surface-design territory, not a hook concern.
      return null;
    }
    // Fallback: try .toHex() blindly.
    if (typeof codec.toHex === 'function') return codec.toHex();
  } catch {
    /* fall through */
  }
  return null;
}
