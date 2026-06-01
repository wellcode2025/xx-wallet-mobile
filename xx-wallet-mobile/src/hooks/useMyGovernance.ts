/**
 * useMyGovernance — account-specific governance state for
 * /governance/me.
 *
 * First (and only) Phase 4a slice that pulls per-account storage rather
 * than chain-wide queries:
 *
 *   - democracy.votingOf(account)     → Voting enum (Direct or Delegating)
 *   - elections.voting(account)       → Voter struct (council vote slate)
 *   - tips.tips.entries() filtered    → tip endorsements by this user
 *
 * Defensive throughout — Promise.allSettled + async-IIFE wrap per the
 * Slice 4.4 pattern. Errors from any one branch leave the others
 * intact. The hook never wholesale-errors; partial state always
 * renders. The screen uses the surface-error-message pattern from
 * feedback_surface_error_message_on_screen for any genuinely-failed
 * reads.
 *
 * Treasury proposer bonds and bounty proposer / curator bonds are
 * deferred to a polish pass — at observation Aaron isn't a proposer
 * of any active treasury proposal and not a curator of any active
 * bounty, so the section would render empty either way.
 */

import { useEffect, useState } from 'react';
import { BN } from '@polkadot/util';
import { xxApi } from '@/api';
import {
  parseCouncilVote,
  parseMyVoting,
  type MyCouncilVote,
  type MyDemocracyVoting,
} from './governanceVoting';

export interface MyTipEndorsement {
  /** Tip hash. */
  hash: string;
  /** Account being tipped. */
  who: string;
  /** Amount the active account endorsed with. */
  tipAmount: BN;
}

interface UseMyGovernanceResult {
  /** Active address the hook was invoked for, echoed back for the screen. */
  address: string | null;
  /** Decoded democracy voting state — Direct, Delegating, or none. */
  voting: MyDemocracyVoting;
  /** Decoded council vote slate, or null if not voting. */
  councilVote: MyCouncilVote | null;
  /** Tips where this account appears as an endorser. */
  tipEndorsements: MyTipEndorsement[];
  /** Per-branch failure flag — true if that branch errored out. */
  votingFailed: boolean;
  councilFailed: boolean;
  tipsFailed: boolean;
  /** Aggregate diagnostic — concatenated branch error messages. */
  diagnostic: string | null;
  isLoading: boolean;
}

const EMPTY_RESULT: UseMyGovernanceResult = {
  address: null,
  voting: { kind: 'none' },
  councilVote: null,
  tipEndorsements: [],
  votingFailed: false,
  councilFailed: false,
  tipsFailed: false,
  diagnostic: null,
  isLoading: false,
};

export function useMyGovernance(
  address: string | null | undefined
): UseMyGovernanceResult {
  const [state, setState] = useState<UseMyGovernanceResult>({
    ...EMPTY_RESULT,
    address: address ?? null,
  });

  useEffect(() => {
    if (!address) {
      setState({ ...EMPTY_RESULT, address: null });
      return;
    }
    let cancelled = false;
    setState({
      ...EMPTY_RESULT,
      address,
      isLoading: true,
    });

    (async () => {
      try {
        const api = await xxApi.getApi();
        if (cancelled) return;

        const [votingResult, councilResult, tipsResult] =
          await Promise.allSettled([
            (async () => {
              const q: any = api.query.democracy?.votingOf;
              if (!q) {
                throw new Error('democracy.votingOf not available');
              }
              return q(address);
            })(),
            (async () => {
              const q: any = (api.query as any).elections?.voting;
              if (!q) {
                throw new Error('elections.voting not available');
              }
              return q(address);
            })(),
            (async () => {
              const q: any = api.query.tips?.tips?.entries;
              if (!q) {
                throw new Error('tips.tips.entries not available');
              }
              return q();
            })(),
          ]);
        if (cancelled) return;

        const { voting, votingFailed, votingDiag } = readVoting(votingResult);
        const { councilVote, councilFailed, councilDiag } = readCouncilVote(
          councilResult
        );
        const { tipEndorsements, tipsFailed, tipsDiag } = readTipEndorsements(
          tipsResult,
          address
        );

        const diagnostic =
          [votingDiag, councilDiag, tipsDiag].filter(Boolean).join(' · ') ||
          null;

        if (cancelled) return;
        setState({
          address,
          voting,
          councilVote,
          tipEndorsements,
          votingFailed,
          councilFailed,
          tipsFailed,
          diagnostic,
          isLoading: false,
        });
      } catch (err) {
        if (cancelled) return;
        // Outer try only catches xxApi.getApi() failures — every other
        // branch is contained. Surface the message in `diagnostic`.
        setState({
          address,
          voting: { kind: 'none' },
          councilVote: null,
          tipEndorsements: [],
          votingFailed: true,
          councilFailed: true,
          tipsFailed: true,
          diagnostic: (err as Error)?.message ?? String(err),
          isLoading: false,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  return state;
}

function readVoting(result: PromiseSettledResult<unknown>): {
  voting: MyDemocracyVoting;
  votingFailed: boolean;
  votingDiag: string | null;
} {
  if (result.status === 'rejected') {
    const msg = (result.reason as Error)?.message ?? String(result.reason);
    console.warn('[useMyGovernance] democracy.votingOf failed:', msg);
    return { voting: { kind: 'none' }, votingFailed: true, votingDiag: `voting: ${msg}` };
  }
  try {
    return {
      voting: parseMyVoting(result.value),
      votingFailed: false,
      votingDiag: null,
    };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.warn('[useMyGovernance] parseMyVoting failed:', msg);
    return { voting: { kind: 'none' }, votingFailed: true, votingDiag: `voting: ${msg}` };
  }
}

function readCouncilVote(result: PromiseSettledResult<unknown>): {
  councilVote: MyCouncilVote | null;
  councilFailed: boolean;
  councilDiag: string | null;
} {
  if (result.status === 'rejected') {
    const msg = (result.reason as Error)?.message ?? String(result.reason);
    console.warn('[useMyGovernance] elections.voting failed:', msg);
    return { councilVote: null, councilFailed: true, councilDiag: `council: ${msg}` };
  }
  try {
    return {
      councilVote: parseCouncilVote(result.value),
      councilFailed: false,
      councilDiag: null,
    };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.warn('[useMyGovernance] parseCouncilVote failed:', msg);
    return { councilVote: null, councilFailed: true, councilDiag: `council: ${msg}` };
  }
}

function readTipEndorsements(
  result: PromiseSettledResult<unknown>,
  address: string
): {
  tipEndorsements: MyTipEndorsement[];
  tipsFailed: boolean;
  tipsDiag: string | null;
} {
  if (result.status === 'rejected') {
    const msg = (result.reason as Error)?.message ?? String(result.reason);
    console.warn('[useMyGovernance] tips.tips.entries failed:', msg);
    return { tipEndorsements: [], tipsFailed: true, tipsDiag: `tips: ${msg}` };
  }
  const tipEndorsements: MyTipEndorsement[] = [];
  try {
    const entries: any[] = result.value as any[];
    if (!Array.isArray(entries)) return { tipEndorsements: [], tipsFailed: false, tipsDiag: null };
    for (const [key, opt] of entries) {
      if (!opt?.isSome) continue;
      try {
        const hash = key?.args?.[0]?.toHex?.();
        if (!hash) continue;
        const tip = opt.unwrap();
        const tipsList: any = tip?.tips;
        if (!Array.isArray(tipsList)) continue;
        for (const endorsement of tipsList) {
          let endorser: string | null = null;
          let amount: BN | null = null;
          try {
            if (endorsement?.who?.toString) {
              endorser = endorsement.who.toString();
              amount = endorsement.value?.toBn?.() ?? null;
            } else if (Array.isArray(endorsement)) {
              endorser = endorsement[0]?.toString?.() ?? null;
              amount = endorsement[1]?.toBn?.() ?? null;
            }
          } catch {
            /* skip endorser */
          }
          if (endorser === address && amount) {
            const who = tip?.who?.toString?.() ?? '';
            tipEndorsements.push({ hash, who, tipAmount: amount });
            break;
          }
        }
      } catch {
        /* skip tip */
      }
    }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.warn('[useMyGovernance] tips iteration failed:', msg);
    return { tipEndorsements: [], tipsFailed: true, tipsDiag: `tips: ${msg}` };
  }
  return { tipEndorsements, tipsFailed: false, tipsDiag: null };
}
