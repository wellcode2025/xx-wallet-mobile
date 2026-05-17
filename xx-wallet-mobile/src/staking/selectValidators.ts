/**
 * Auto-nominate validator selection — top-16 by projected return.
 *
 * Ported from the xxfoundation `staking.xx.network` reference
 * (`src/simple-staking/selection.ts`). Combines on-chain state and
 * a client-side Phragmén pass to pick the validators the wallet's
 * one-tx bond+nominate flow will submit.
 *
 * Pipeline:
 *   1. Pull staking state in parallel — bonded, ledger, validators,
 *      nominators, validatorCount, activeEra.
 *   2. Pull `erasRewardPoints` for the last N eras (default 7) to
 *      derive each validator's normalised performance score.
 *   3. Build a voters list from current nominators (excluding the
 *      nominator we're selecting for) plus validator self-votes.
 *   4. Run seq-Phragmén to compute the elected set + each validator's
 *      backed stake.
 *   5. For each elected validator compute projected return:
 *      avgPerformance × (avgStake / backedStake) × (1 − commission).
 *   6. Filter out blocked validators and ones at 256+ backers (clipped
 *      out anyway), apply optional custom filters, sort by return
 *      descending, take top 16.
 *
 * ---------------------------------------------------------------------
 * Copyright (c) xxfoundation, Apache-2.0 licensed (see upstream
 * staking.xx.network LICENSE).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Modifications by xx-wallet-mobile (2026-05-16):
 *   - Removed lodash dependency (inlined uniq via Set).
 *   - Exposed `eras` (history depth for performance scoring) and
 *     `targetCount` (top-N to return) as parameters.
 *   - Stripped the env-var-driven filter loading (foundation's
 *     COMMISSION_FILTER + FILTER_STATIC_LIST_URL); custom filters are
 *     now a plain function-array parameter for the wallet to pass in.
 *   - Telemetry: returns timing breakdown for the chain reads + the
 *     Phragmén pass so the UI can show observability.
 *   - Algorithm and scoring logic preserved verbatim.
 * ---------------------------------------------------------------------
 */

import type { ApiPromise } from '@polkadot/api';
import BigNumber from 'bignumber.js';

import { seqPhragmen, type ElectedValidator, type Voter } from './phragmen';

// Types like PalletStakingNominations / PalletStakingStakingLedger /
// PalletStakingValidatorPrefs would come from `polkadot-types-from-chain`
// codegen against the xx chain metadata. The foundation app does that
// codegen; the wallet doesn't, so we use loose runtime shapes here and
// match the `any` cast pattern used by useStakingPosition.ts elsewhere
// in the codebase. The algorithm doesn't care about strict typing — it
// reads .toString(), .toNumber(), .toBn(), .toPrimitive() and
// constructs BigNumbers.
type ChainLedger = { active: { toString(): string; toBn(): unknown } };
type ChainValidatorPrefs = {
  commission: { toNumber(): number };
  blocked: { toPrimitive(): boolean | unknown };
};
type ChainNominations = { targets: { toString(): string }[] };

export interface AutoNominateValidator {
  validatorId: string;
  backedStake: BigNumber;
  score: BigNumber;
  backers: number;
  /** Projected return contribution: avgPerformance × (avgStake / backedStake) × (1 − commission). */
  return: number;
  blocked: boolean;
}

export interface AutoNominateTimings {
  /** Chain reads — the four .entries() scans + 7-era points walk. */
  chainReadMs: number;
  /** Pure JS work — voter-list construction + Phragmén + scoring + sort. */
  computeMs: number;
  /** Total wall time end-to-end. */
  totalMs: number;
}

export interface AutoNominateResult {
  /** Top N validators by projected return, ready for staking.nominate(). */
  selected: AutoNominateValidator[];
  /** The full elected set, scored. Useful for showing alternatives or debugging. */
  allElected: AutoNominateValidator[];
  timings: AutoNominateTimings;
}

export type ValidatorFilter = (v: AutoNominateValidator) => boolean;

/** Convenience: filter out validators present in `list`. */
export const excludeList =
  (list: string[]): ValidatorFilter =>
  (v) =>
    !list.includes(v.validatorId);

/** Convenience: only keep validators present in `list`. */
export const allowList =
  (list: string[]): ValidatorFilter =>
  (v) =>
    list.includes(v.validatorId);

interface ChainData {
  // Current state
  controllers: Record<string, string>;
  ledgers: Record<string, ChainLedger>;
  validators: Record<string, ChainValidatorPrefs>;
  nominators: Record<string, ChainNominations>;
  count: number;
  // Performance: validator address → array of (points / avgPointsForEra) values
  performance: Record<string, number[]>;
}

const DEFAULT_PERFORMANCE_ERAS = 7;
const DEFAULT_TARGET_COUNT = 16;
/** Polkadot's `maxNominatorRewardedPerValidator`; xx confirms same value (256). */
const MAX_NOMINATIONS_PER_VALIDATOR = 256;
/** Validators without recorded performance get this default rating. */
const DEFAULT_PERFORMANCE_RATING = 0.25;

async function getChainData(
  api: ApiPromise,
  eras = DEFAULT_PERFORMANCE_ERAS
): Promise<ChainData> {
  const data: ChainData = {
    controllers: {},
    ledgers: {},
    validators: {},
    nominators: {},
    count: 0,
    performance: {},
  };

  const [bonded, ledger, validators, nominators, validatorCount, activeEra] =
    (await Promise.all([
      api.query.staking.bonded.entries(),
      api.query.staking.ledger.entries(),
      api.query.staking.validators.entries(),
      api.query.staking.nominators.entries(),
      api.query.staking.validatorCount(),
      api.query.staking.activeEra(),
    ])) as unknown as [
      Array<[{ args: { toString(): string }[] }, { toString(): string }]>,
      Array<[{ args: { toString(): string }[] }, { isSome: boolean; unwrap(): ChainLedger }]>,
      Array<[{ args: { toString(): string }[] }, ChainValidatorPrefs]>,
      Array<[{ args: { toString(): string }[] }, { isSome: boolean; unwrap(): ChainNominations }]>,
      { toNumber(): number },
      { unwrap(): { index: { toNumber(): number } } },
    ];

  bonded.forEach(([{ args }, controller]) => {
    data.controllers[args[0].toString()] = controller.toString();
  });
  ledger.forEach(([{ args }, ledgerOpt]) => {
    if (!ledgerOpt.isSome) return;
    data.ledgers[args[0].toString()] = ledgerOpt.unwrap();
  });
  validators.forEach(([{ args }, prefs]) => {
    data.validators[args[0].toString()] = prefs;
  });
  nominators.forEach(([{ args }, nominationsOpt]) => {
    if (!nominationsOpt.isSome) return;
    data.nominators[args[0].toString()] = nominationsOpt.unwrap();
  });

  data.count = validatorCount.toNumber();

  // Performance pass — last N eras of points, normalised to era-average
  const activeEraNumber = activeEra.unwrap().index.toNumber();
  const firstEra = activeEraNumber > eras ? activeEraNumber - eras : 0;

  const pointsEntries = (await Promise.all(
    Array.from({ length: activeEraNumber - firstEra + 1 }, (_, i) =>
      api.query.staking.erasRewardPoints(firstEra + i)
    )
  )) as unknown as Array<{
    individual: {
      forEach(
        cb: (value: { toNumber(): number }, key: { toString(): string }) => void
      ): void;
    };
  }>;

  pointsEntries.forEach((erasPoints) => {
    const validatorPoints: [string, number][] = [];
    let totalPoints = 0;
    let count = 0;
    erasPoints.individual.forEach(
      (pointsIn: { toNumber(): number }, addr: { toString(): string }) => {
        const points = pointsIn.toNumber();
        validatorPoints.push([addr.toString(), points]);
        totalPoints += points;
        count += 1;
      }
    );
    if (count === 0) return;
    const avgPoints = totalPoints / count;
    validatorPoints.forEach(([addr, points]) => {
      const rating = points / avgPoints;
      if (addr in data.performance) {
        data.performance[addr].push(rating);
      } else {
        data.performance[addr] = [rating];
      }
    });
  });

  return data;
}

function buildVotersList(chainData: ChainData, exclude: string): Voter[] {
  const voters: Voter[] = [];

  // Add nominators (excluding the address we're selecting for)
  Object.keys(chainData.nominators).forEach((nomId) => {
    if (exclude === nomId) return;
    const noms = chainData.nominators[nomId];
    const targets: string[] = noms.targets.map((target) => target.toString());
    // Remove duplicates and non-validators from targets
    const filteredTargets: string[] = Array.from(
      new Set(targets.filter((t) => t in chainData.validators))
    );
    const controllerAddr = chainData.controllers[nomId];
    const ledger = controllerAddr ? chainData.ledgers[controllerAddr] : undefined;
    if (!ledger || filteredTargets.length === 0) return;
    voters.push({
      nominatorId: nomId,
      stake: ledger.active.toString(),
      targets: filteredTargets,
    });
  });

  // Add validator self-votes
  Object.keys(chainData.validators).forEach((valId) => {
    const controllerAddr = chainData.controllers[valId];
    const ledger = controllerAddr ? chainData.ledgers[controllerAddr] : undefined;
    if (!ledger) return;
    voters.push({
      nominatorId: valId,
      stake: ledger.active.toString(),
      targets: [valId],
    });
  });

  return voters;
}

function computeReturn(
  chainData: ChainData,
  elected: ElectedValidator,
  avgStake: BigNumber
): AutoNominateValidator {
  const performance = chainData.performance[elected.validatorId];
  const avgPerformance =
    performance && performance.length > 0
      ? performance.reduce((sum, val) => sum + val, 0) / performance.length
      : DEFAULT_PERFORMANCE_RATING;
  const commission =
    chainData.validators[elected.validatorId].commission.toNumber() / 1e9;
  const blocked = Boolean(
    chainData.validators[elected.validatorId].blocked.toPrimitive()
  );
  const stakingReturn =
    avgStake.dividedBy(elected.backedStake).toNumber() * (1 - commission);
  return {
    validatorId: elected.validatorId,
    backedStake: elected.backedStake,
    score: elected.score,
    backers: elected.backers,
    return: avgPerformance * stakingReturn,
    blocked,
  };
}

function orderValidatorsByReturn(
  chainData: ChainData,
  validators: ElectedValidator[],
  customFilters: ValidatorFilter[],
  targetCount: number
): { all: AutoNominateValidator[]; top: AutoNominateValidator[] } {
  if (validators.length === 0) return { all: [], top: [] };
  // Compute average stake across the elected set
  const avgStake = validators
    .reduce((sum, val) => sum.plus(val.backedStake), new BigNumber(0))
    .dividedBy(validators.length);
  // Score each, filter, sort
  const all: AutoNominateValidator[] = validators.map((v) =>
    computeReturn(chainData, v, avgStake)
  );
  const top = all
    .filter(({ backers, blocked }) => !blocked && backers < MAX_NOMINATIONS_PER_VALIDATOR)
    .filter((v) => customFilters.every((f) => f(v)))
    .sort((a, b) => (a.return > b.return ? -1 : 1))
    .slice(0, targetCount);
  return { all, top };
}

export interface SelectValidatorsOptions {
  /** Address to exclude from voter list (the nominator we're selecting for). */
  nominator: string;
  /** Optional filters (e.g. excludeList of known-bad validators). Default: none. */
  customFilters?: ValidatorFilter[];
  /** How many eras of history to weight performance over. Default 7. */
  eras?: number;
  /** Top-N to return. Default 16 (xx network's maxNominations). */
  targetCount?: number;
}

/**
 * End-to-end auto-nominate. Returns top-N validators by projected return,
 * plus telemetry for the UI to show "selected in N.NN seconds".
 */
export async function selectValidators(
  api: ApiPromise,
  opts: SelectValidatorsOptions
): Promise<AutoNominateResult> {
  const {
    nominator,
    customFilters = [],
    eras = DEFAULT_PERFORMANCE_ERAS,
    targetCount = DEFAULT_TARGET_COUNT,
  } = opts;

  const tStart = Date.now();
  const chainData = await getChainData(api, eras);
  const tAfterChain = Date.now();

  const voters = buildVotersList(chainData, nominator);
  const [, elected] = seqPhragmen(voters, chainData.count);
  const { all, top } = orderValidatorsByReturn(
    chainData,
    elected,
    customFilters,
    targetCount
  );
  const tEnd = Date.now();

  return {
    selected: top,
    allElected: all,
    timings: {
      chainReadMs: tAfterChain - tStart,
      computeMs: tEnd - tAfterChain,
      totalMs: tEnd - tStart,
    },
  };
}
