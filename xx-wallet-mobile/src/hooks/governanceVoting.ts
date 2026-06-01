/**
 * Pure decoders for democracy's Voting enum and elections' Voter struct.
 *
 * Substrate shapes (xx v206):
 *
 *   pub enum Voting<Balance, AccountId, BlockNumber> {
 *       Direct {
 *           votes: Vec<(ReferendumIndex, AccountVote<Balance>)>,
 *           delegations: Delegations<Balance>,
 *           prior: PriorLock<BlockNumber, Balance>,
 *       },
 *       Delegating { balance, target, conviction, delegations, prior },
 *   }
 *
 *   pub struct Voter<AccountId, Balance> {
 *       votes: Vec<AccountId>,
 *       stake: Balance,
 *       deposit: Balance,
 *   }
 *
 * Both are parsed via `toJSON()` keys per feedback_chain_enum_decoding.
 * Voter is also read via named field with the same defensive pattern as
 * council's SeatHolder (Slice 3.1). Mangle guards reject anything that
 * doesn't yield xx-SS58-prefixed addresses.
 *
 * Exported for testing — useMyGovernance imports and applies these to
 * live chain data.
 */

import { BN } from '@polkadot/util';

export interface PriorLock {
  /** Block at which the lock can be cleared. */
  unlockAt: number;
  /** Amount currently locked. */
  amount: BN;
}

export type MyDemocracyVoting =
  | { kind: 'none' }
  | {
      kind: 'direct';
      votes: Array<{
        refIndex: number;
        aye: boolean | null;
        balance: BN | null;
        conviction: string | null;
      }>;
      priorLock: PriorLock | null;
    }
  | {
      kind: 'delegating';
      target: string;
      conviction: string;
      balance: BN;
      priorLock: PriorLock | null;
    };

/**
 * Parse a democracy Voting codec into our typed discriminant.
 *
 * Defensive across the two known representations of AccountVote inside
 * Direct.votes: Standard {vote, balance} and Split {aye, nay}. For
 * Slice 5 we surface only Standard with friendly aye/conviction; Split
 * collapses to `aye: null` so the row renders honestly.
 */
export function parseMyVoting(votingCodec: any): MyDemocracyVoting {
  let json: any;
  try {
    json = votingCodec?.toJSON?.();
  } catch {
    return { kind: 'none' };
  }
  if (!json || typeof json !== 'object') return { kind: 'none' };

  if ('direct' in json) {
    const inner = (json as any).direct ?? {};
    const rawVotes = Array.isArray(inner.votes) ? inner.votes : [];
    const votes = rawVotes
      .map((v: any) => parseSingleDirectVote(v))
      .filter((v: ReturnType<typeof parseSingleDirectVote>) => v !== null) as Array<{
      refIndex: number;
      aye: boolean | null;
      balance: BN | null;
      conviction: string | null;
    }>;
    const priorLock = parsePriorLock(inner.prior);
    if (votes.length === 0 && priorLock === null) return { kind: 'none' };
    return { kind: 'direct', votes, priorLock };
  }

  if ('delegating' in json) {
    const inner = (json as any).delegating ?? {};
    const target =
      typeof inner.target === 'string'
        ? inner.target
        : String(inner.target ?? '');
    if (!target.startsWith('6')) return { kind: 'none' };
    const conviction = String(inner.conviction ?? 'None');
    const balance = parseBn(inner.balance);
    if (balance == null) return { kind: 'none' };
    return {
      kind: 'delegating',
      target,
      conviction,
      balance,
      priorLock: parsePriorLock(inner.prior),
    };
  }

  return { kind: 'none' };
}

function parseSingleDirectVote(raw: any): {
  refIndex: number;
  aye: boolean | null;
  balance: BN | null;
  conviction: string | null;
} | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const refIndex =
    typeof raw[0] === 'number' ? raw[0] : Number(raw[0]);
  if (!Number.isFinite(refIndex)) return null;
  const accountVote = raw[1];
  if (!accountVote || typeof accountVote !== 'object') {
    return { refIndex, aye: null, balance: null, conviction: null };
  }
  if ('standard' in accountVote) {
    const inner = (accountVote as any).standard ?? {};
    // `vote` is a packed u8 — bit 0x80 = aye, low nibble = conviction id.
    const voteRaw = inner.vote;
    let aye: boolean | null = null;
    let conviction: string | null = null;
    try {
      const voteByte =
        typeof voteRaw === 'number'
          ? voteRaw
          : typeof voteRaw === 'string'
          ? parseInt(voteRaw.startsWith('0x') ? voteRaw : `0x${voteRaw}`, 16)
          : null;
      if (voteByte != null && Number.isFinite(voteByte)) {
        aye = (voteByte & 0x80) !== 0;
        const conv = voteByte & 0x7f;
        conviction = convictionLabel(conv);
      }
    } catch {
      /* leave nulls */
    }
    return {
      refIndex,
      aye,
      balance: parseBn(inner.balance),
      conviction,
    };
  }
  // Split / SplitAbstain — surface as aye=null so UI shows "Split vote".
  return { refIndex, aye: null, balance: null, conviction: null };
}

function parsePriorLock(raw: any): PriorLock | null {
  if (!raw) return null;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  try {
    const unlockAt =
      typeof raw[0] === 'number' ? raw[0] : Number(raw[0]);
    const amount = parseBn(raw[1]);
    if (!Number.isFinite(unlockAt) || !amount) return null;
    if (unlockAt === 0 && amount.isZero()) return null; // empty default
    return { unlockAt, amount };
  } catch {
    return null;
  }
}

function convictionLabel(id: number): string {
  switch (id) {
    case 0:
      return 'None (0.1×)';
    case 1:
      return 'Locked 1× (1 day)';
    case 2:
      return 'Locked 2× (2 days)';
    case 3:
      return 'Locked 4× (4 days)';
    case 4:
      return 'Locked 8× (8 days)';
    case 5:
      return 'Locked 16× (16 days)';
    case 6:
      return 'Locked 32× (32 days)';
    default:
      return `Conviction ${id}`;
  }
}

// ---------------------------------------------------------------------------
// Elections Voter struct (parallel to council's SeatHolder)
// ---------------------------------------------------------------------------

export interface MyCouncilVote {
  /** AccountIds voted for (up to 16 on xx). */
  votes: string[];
  /** Stake amount placed behind those votes. */
  stake: BN;
  /** Voting bond deposit. */
  deposit: BN;
}

/**
 * Parse the elections.voting Voter struct.
 *
 * Both struct-named-field (modern Voter struct) and tuple shapes
 * (older `(Vec<AccountId>, Balance)` form) are supported, with a
 * mangle guard that rejects votes whose addresses don't start with
 * "6". Returns null when the codec has no votes or fails to decode.
 */
export function parseCouncilVote(codec: any): MyCouncilVote | null {
  if (!codec) return null;
  try {
    // Modern Voter struct: { votes, stake, deposit }
    if (codec.votes !== undefined) {
      const votesRaw = codec.votes;
      const votes: string[] = [];
      if (Array.isArray(votesRaw)) {
        for (const acc of votesRaw) {
          const s = acc?.toString?.();
          if (typeof s === 'string' && s.startsWith('6')) votes.push(s);
        }
      }
      const stake = codec.stake?.toBn?.() ?? new BN(0);
      const deposit = codec.deposit?.toBn?.() ?? new BN(0);
      // If nothing voted AND no stake, treat as "not voting".
      if (votes.length === 0 && stake.isZero() && deposit.isZero()) return null;
      return { votes, stake, deposit };
    }
    // Older tuple shape: (Vec<AccountId>, Balance).
    if (Array.isArray(codec)) {
      const [votesCodec, stakeCodec] = codec;
      const votes: string[] = [];
      if (Array.isArray(votesCodec)) {
        for (const acc of votesCodec) {
          const s = acc?.toString?.();
          if (typeof s === 'string' && s.startsWith('6')) votes.push(s);
        }
      }
      const stake = stakeCodec?.toBn?.() ?? new BN(0);
      if (votes.length === 0 && stake.isZero()) return null;
      return { votes, stake, deposit: new BN(0) };
    }
  } catch {
    /* fall through */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBn(raw: any): BN | null {
  if (raw == null) return null;
  try {
    if (raw instanceof BN) return raw;
    if (typeof raw.toBn === 'function') return raw.toBn();
    if (typeof raw === 'number') return new BN(raw);
    if (typeof raw === 'string') {
      if (raw.startsWith('0x')) return new BN(raw.slice(2), 16);
      if (/^\d+$/.test(raw)) return new BN(raw);
    }
  } catch {
    /* fall through */
  }
  return null;
}
