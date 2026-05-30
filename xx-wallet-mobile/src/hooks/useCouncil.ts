/**
 * useCouncil — read-only state for /governance/council.
 *
 * Pulls every piece the official xx web wallet's Council and Tech.
 * comm. pages render:
 *
 *   - Council collective: members, prime, live motions, historical
 *     count. The `council` pallet name is what xx uses; that part is
 *     straightforward.
 *   - Elections (Phragmen): members + backing stake, runners-up +
 *     stake, candidates + stake, term duration. xx registers this
 *     half under the bare name `elections` (the spike confirmed —
 *     `electionsPhragmen` etc. are absent). The same 13 SS58s appear
 *     as `council.members` and `elections.members`; we use the
 *     elections version because it carries the per-member backing
 *     stake.
 *   - Technical Committee: members + prime + live motions + historical.
 *     On xx the 4 tech-comm members are a strict subset of the 13
 *     council members.
 *
 * Identity prefetch fires one batch for the union of all visible
 * addresses (13 + 10 + 4 = up to 27, with overlap collapsed) so the
 * MemberRow components hit the cache by render time.
 *
 * One-shot fetch on mount. The term-progress bar ticks live off
 * useConnectionStore.blockNumber separately.
 */

import { useEffect, useState } from 'react';
import type { BN } from '@polkadot/util';
import { xxApi } from '@/api';
import { resolveIdentitiesBatch } from '@/governance';

export interface CouncilMember {
  address: string;
  /** Backing stake (in planck) from the Phragmen election. Null for
   *  the tech-comm side (which doesn't carry backing on chain). */
  stake: BN | null;
  /** True iff this member is the council's prime. */
  isPrime: boolean;
}

export interface CouncilCandidate {
  address: string;
  stake: BN | null;
}

export interface CouncilMotion {
  /** 0x-prefixed motion hash. */
  hash: string;
}

export interface TechCommState {
  /** Tech-comm members (4 on xx). No backing stake on this pallet. */
  members: { address: string; isPrime: boolean }[];
  primeAddress: string | null;
  motions: CouncilMotion[];
  /** Historical count of tech-comm proposals ever made. */
  proposalCount: number;
}

interface UseCouncilResult {
  /** Council members (13 on xx). Includes per-member backing stake. */
  members: CouncilMember[];
  /** Runners-up (10 on xx). Eligible for promotion if a seat opens. */
  runnersUp: CouncilCandidate[];
  /** Candidates (0 on xx today). New-cycle hopefuls. */
  candidates: CouncilCandidate[];
  /** Council prime address, if set. */
  primeAddress: string | null;
  /** Term duration in blocks (100,800 on xx = 7 days). */
  termDuration: number;
  /** Target seat count (13 on xx). */
  desiredMembers: number;
  /** Target runner-up count (10 on xx). */
  desiredRunnersUp: number;
  /** Candidacy bond required to submit candidacy. */
  candidacyBond: BN | null;
  /** Live council motions (currently 0 on xx — usually). */
  councilMotions: CouncilMotion[];
  /** Historical count of council motions ever made. */
  councilProposalCount: number;
  /** Tech-comm state — separate fetch, same shape as council. */
  techComm: TechCommState;
  isLoading: boolean;
  error: Error | null;
}

const EMPTY_TECH_COMM: TechCommState = {
  members: [],
  primeAddress: null,
  motions: [],
  proposalCount: 0,
};

export function useCouncil(): UseCouncilResult {
  const [state, setState] = useState<UseCouncilResult>({
    members: [],
    runnersUp: [],
    candidates: [],
    primeAddress: null,
    termDuration: 0,
    desiredMembers: 0,
    desiredRunnersUp: 0,
    candidacyBond: null,
    councilMotions: [],
    councilProposalCount: 0,
    techComm: EMPTY_TECH_COMM,
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

        // Collective + elections constants in parallel.
        const electionsConsts: any = (api.consts as any).elections ?? {};
        const termDuration = numFromConst(electionsConsts.termDuration);
        const desiredMembers = numFromConst(electionsConsts.desiredMembers);
        const desiredRunnersUp = numFromConst(electionsConsts.desiredRunnersUp);
        const candidacyBond = electionsConsts.candidacyBond
          ? electionsConsts.candidacyBond.toBn()
          : null;

        // Parallel reads — three pallets touched.
        const [
          primeOpt,
          councilMotionsCodec,
          councilProposalCountCodec,
          electionsMembersCodec,
          runnersUpCodec,
          candidatesCodec,
          tcMembersCodec,
          tcPrimeOpt,
          tcMotionsCodec,
          tcProposalCountCodec,
        ] = await Promise.all([
          api.query.council.prime(),
          api.query.council.proposals(),
          (api.query.council as any).proposalCount?.() ?? Promise.resolve(null),
          (api.query as any).elections.members(),
          (api.query as any).elections.runnersUp(),
          (api.query as any).elections.candidates(),
          api.query.technicalCommittee.members(),
          api.query.technicalCommittee.prime(),
          api.query.technicalCommittee.proposals(),
          (api.query.technicalCommittee as any).proposalCount?.() ??
            Promise.resolve(null),
        ]);
        if (cancelled) return;

        const primeAddress = optAddress(primeOpt);
        const tcPrimeAddress = optAddress(tcPrimeOpt);

        const members: CouncilMember[] = decodeStakedList(
          electionsMembersCodec
        ).map((entry) => ({
          address: entry.address,
          stake: entry.stake,
          isPrime: !!primeAddress && entry.address === primeAddress,
        }));

        const runnersUp: CouncilCandidate[] = decodeStakedList(runnersUpCodec);
        const candidates: CouncilCandidate[] = decodeStakedList(candidatesCodec);

        const councilMotions = decodeMotionHashes(councilMotionsCodec);
        const councilProposalCount = councilProposalCountCodec
          ? (councilProposalCountCodec as any).toNumber()
          : 0;

        const tcMembers = (tcMembersCodec as unknown as any[]).map(
          (accCodec) => {
            const address = accCodec.toString();
            return {
              address,
              isPrime: !!tcPrimeAddress && address === tcPrimeAddress,
            };
          }
        );

        const techComm: TechCommState = {
          members: tcMembers,
          primeAddress: tcPrimeAddress,
          motions: decodeMotionHashes(tcMotionsCodec),
          proposalCount: tcProposalCountCodec
            ? (tcProposalCountCodec as any).toNumber()
            : 0,
        };

        // Identity prefetch — union of all visible addresses.
        const allAddresses = new Set<string>();
        for (const m of members) allAddresses.add(m.address);
        for (const r of runnersUp) allAddresses.add(r.address);
        for (const c of candidates) allAddresses.add(c.address);
        for (const m of tcMembers) allAddresses.add(m.address);
        if (allAddresses.size > 0) {
          resolveIdentitiesBatch([...allAddresses]).catch(() => {
            /* identity enrichment, not load-bearing */
          });
        }

        if (cancelled) return;
        setState({
          members,
          runnersUp,
          candidates,
          primeAddress,
          termDuration,
          desiredMembers,
          desiredRunnersUp,
          candidacyBond,
          councilMotions,
          councilProposalCount,
          techComm,
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

function optAddress(codec: any): string | null {
  if (!codec) return null;
  try {
    if (codec.isSome) return codec.unwrap().toString();
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Decode a Vec<(AccountId, Balance)> into a typed list. Used for
 * elections.members / runnersUp / candidates, all of which share this
 * tuple shape.
 */
function decodeStakedList(
  vecCodec: any
): { address: string; stake: import('@polkadot/util').BN | null }[] {
  if (!vecCodec || !Array.isArray(vecCodec)) return [];
  const out: { address: string; stake: import('@polkadot/util').BN | null }[] = [];
  for (const entry of vecCodec) {
    try {
      // entry is a Codec tuple — destructure as [account, balance].
      const [accCodec, balCodec] = entry;
      const address = accCodec.toString();
      const stake = balCodec?.toBn?.() ?? null;
      out.push({ address, stake });
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

function decodeMotionHashes(vecCodec: any): CouncilMotion[] {
  if (!vecCodec || !Array.isArray(vecCodec)) return [];
  const out: CouncilMotion[] = [];
  for (const h of vecCodec) {
    try {
      out.push({ hash: h.toHex() });
    } catch {
      /* skip */
    }
  }
  return out;
}
