/**
 * Tests for parseMyVoting (democracy Voting enum) and parseCouncilVote
 * (elections Voter struct).
 *
 * Both use the named-field / toJSON discipline: decode enums via
 * .toJSON()/named fields with a mangle guard (addresses start with '6'),
 * since auto-derived .isFoo/.asFoo accessors and tuple destructure are
 * unreliable on the xx runtime. Mangle guards reject anything that
 * doesn't yield xx-SS58 addresses, so a future polkadot-codec shape
 * change renders an empty section rather than garbage.
 */

import { describe, expect, it } from 'vitest';
import { BN } from '@polkadot/util';
import { parseCouncilVote, parseMyVoting } from './governanceVoting';

const ALICE = '6VaNn3ntdFWQWysscqt2bxDtqKBkeKqFvnzgYATQAytefTVT';
const BOB = '6WhoHGAWQHZUGoYew3KwA18pEPVBmzLnfbhZmXp5oEqMouJf';
const CARBACK = '6YDEf5Q78EFHbmiJRFqfpNpiGQjMZf1Cqpy2Dmi8FRYJVTCQ';

const codecOf = (json: unknown) => ({ toJSON: () => json });
const stubAccount = (s: string) => ({ toString: () => s });
const stubBalance = (raw: string) => ({ toBn: () => new BN(raw) });

// ---------------------------------------------------------------------------
// parseMyVoting
// ---------------------------------------------------------------------------

describe('parseMyVoting — Direct variant', () => {
  it('returns kind: none for Direct with no votes and no prior lock', () => {
    const r = parseMyVoting(
      codecOf({
        direct: {
          votes: [],
          delegations: { votes: '0', capital: '0' },
          prior: [0, '0'],
        },
      })
    );
    expect(r.kind).toBe('none');
  });

  it('decodes a single Standard aye vote with 1x conviction', () => {
    // vote byte: bit 7 = aye (0x80), low nibble = conviction id 1.
    // 0x80 | 0x01 = 0x81 = 129 decimal.
    const r = parseMyVoting(
      codecOf({
        direct: {
          votes: [
            [
              5,
              { standard: { vote: 129, balance: '1000000000000' } },
            ],
          ],
          delegations: { votes: '0', capital: '0' },
          prior: [0, '0'],
        },
      })
    );
    expect(r.kind).toBe('direct');
    if (r.kind !== 'direct') throw new Error('unreachable');
    expect(r.votes).toHaveLength(1);
    expect(r.votes[0]).toMatchObject({
      refIndex: 5,
      aye: true,
      conviction: 'Locked 1× (1 day)',
    });
    expect(r.votes[0].balance?.toString()).toBe('1000000000000');
    expect(r.priorLock).toBeNull();
  });

  it('decodes a Standard nay vote (vote byte bit 0x80 clear)', () => {
    const r = parseMyVoting(
      codecOf({
        direct: {
          votes: [
            [
              7,
              { standard: { vote: 0x03, balance: '500000000000' } },
            ],
          ],
          delegations: { votes: '0', capital: '0' },
          prior: [0, '0'],
        },
      })
    );
    expect(r.kind).toBe('direct');
    if (r.kind !== 'direct') throw new Error('unreachable');
    expect(r.votes[0].aye).toBe(false);
    expect(r.votes[0].conviction).toBe('Locked 4× (4 days)');
  });

  it('decodes a Split vote as aye:null (we surface only Standard)', () => {
    const r = parseMyVoting(
      codecOf({
        direct: {
          votes: [
            [
              9,
              { split: { aye: '100000000000', nay: '50000000000' } },
            ],
          ],
          delegations: { votes: '0', capital: '0' },
          prior: [0, '0'],
        },
      })
    );
    expect(r.kind).toBe('direct');
    if (r.kind !== 'direct') throw new Error('unreachable');
    expect(r.votes[0].refIndex).toBe(9);
    expect(r.votes[0].aye).toBeNull();
  });

  it('surfaces a prior lock when present even with empty current votes', () => {
    const r = parseMyVoting(
      codecOf({
        direct: {
          votes: [],
          delegations: { votes: '0', capital: '0' },
          prior: [24_000_000, '100000000000'],
        },
      })
    );
    expect(r.kind).toBe('direct');
    if (r.kind !== 'direct') throw new Error('unreachable');
    expect(r.priorLock).not.toBeNull();
    expect(r.priorLock?.unlockAt).toBe(24_000_000);
    expect(r.priorLock?.amount.toString()).toBe('100000000000');
  });
});

describe('parseMyVoting — Delegating variant', () => {
  it('decodes a Delegating with target + conviction + balance', () => {
    const r = parseMyVoting(
      codecOf({
        delegating: {
          balance: '5000000000000',
          target: BOB,
          conviction: 'Locked2x',
          delegations: { votes: '0', capital: '0' },
          prior: [0, '0'],
        },
      })
    );
    expect(r.kind).toBe('delegating');
    if (r.kind !== 'delegating') throw new Error('unreachable');
    expect(r.target).toBe(BOB);
    expect(r.conviction).toBe('Locked2x');
    expect(r.balance.toString()).toBe('5000000000000');
  });

  it('returns none when the delegating target is not an xx SS58', () => {
    const r = parseMyVoting(
      codecOf({
        delegating: {
          balance: '1',
          target: 'who,6Who…ouJf',
          conviction: 'None',
          delegations: { votes: '0', capital: '0' },
          prior: [0, '0'],
        },
      })
    );
    expect(r.kind).toBe('none');
  });
});

describe('parseMyVoting — defensive', () => {
  it('returns none for null / undefined', () => {
    expect(parseMyVoting(null).kind).toBe('none');
    expect(parseMyVoting(undefined).kind).toBe('none');
  });

  it('returns none when toJSON throws', () => {
    const codec = {
      toJSON: () => {
        throw new Error('codec deserialization failure');
      },
    };
    expect(parseMyVoting(codec).kind).toBe('none');
  });

  it('returns none for unrecognised variants', () => {
    expect(parseMyVoting(codecOf({ someFutureVariant: {} })).kind).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// parseCouncilVote
// ---------------------------------------------------------------------------

describe('parseCouncilVote — modern Voter struct', () => {
  it('extracts votes + stake + deposit by named field', () => {
    const codec = {
      votes: [stubAccount(ALICE), stubAccount(BOB), stubAccount(CARBACK)],
      stake: stubBalance('1000000000000'),
      deposit: stubBalance('20000000000'),
    };
    const r = parseCouncilVote(codec);
    expect(r).not.toBeNull();
    expect(r?.votes).toEqual([ALICE, BOB, CARBACK]);
    expect(r?.stake.toString()).toBe('1000000000000');
    expect(r?.deposit.toString()).toBe('20000000000');
  });

  it('skips votes that don\'t look like xx SS58 (mangle guard)', () => {
    const codec = {
      votes: [
        stubAccount(ALICE),
        stubAccount('who,6Who…ouJf'),
        stubAccount(CARBACK),
      ],
      stake: stubBalance('1'),
      deposit: stubBalance('1'),
    };
    const r = parseCouncilVote(codec);
    expect(r?.votes).toEqual([ALICE, CARBACK]);
  });

  it('returns null when nothing is voted and no stake / deposit', () => {
    const codec = {
      votes: [],
      stake: stubBalance('0'),
      deposit: stubBalance('0'),
    };
    expect(parseCouncilVote(codec)).toBeNull();
  });
});

describe('parseCouncilVote — legacy tuple shape', () => {
  it('extracts (Vec<AccountId>, Balance) tuple form', () => {
    const codec: any = [
      [stubAccount(ALICE), stubAccount(BOB)],
      stubBalance('500000000000'),
    ];
    const r = parseCouncilVote(codec);
    expect(r?.votes).toEqual([ALICE, BOB]);
    expect(r?.stake.toString()).toBe('500000000000');
  });
});

describe('parseCouncilVote — defensive', () => {
  it('returns null for null input', () => {
    expect(parseCouncilVote(null)).toBeNull();
  });

  it('returns null when accessor throws', () => {
    const codec = {
      get votes() {
        throw new Error('boom');
      },
    };
    expect(parseCouncilVote(codec)).toBeNull();
  });
});
