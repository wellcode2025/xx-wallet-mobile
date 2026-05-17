/**
 * Sequential Phragmén election + equalisation pass.
 *
 * Ported from the xxfoundation `staking.xx.network` reference
 * (`src/simple-staking/phragmen.ts` in the staking.xx.network-main
 * source bundle). Used by the wallet's auto-nominate feature to
 * predict the elected validator set + each validator's backed
 * stake from current chain state, so we can score candidates and
 * pick the top 16 for one-tx bond+nominate.
 *
 * ---------------------------------------------------------------------
 * Copyright (c) xxfoundation, MIT/Apache-2.0 licensed (see upstream
 * staking.xx.network LICENSE — Apache License, Version 2.0).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Modifications by xx-wallet-mobile (2026-05-16):
 *   - Removed lodash dependency (inlined a typed `minBy` helper).
 *   - Tightened types (explicit return types, no implicit any).
 *   - Iteration count exposed at the call site for testability.
 *   - Algorithm logic, variable naming, and execution order preserved
 *     verbatim from upstream so this stays a faithful port.
 * ---------------------------------------------------------------------
 */

import BigNumber from 'bignumber.js';

export interface Voter {
  nominatorId: string;
  /** Stake as a decimal string (raw planck). */
  stake: string;
  targets: string[];
}

interface Nominator {
  nominatorId: string;
  budget: BigNumber;
  edges: Edge[];
  load: BigNumber;
}

export interface ElectedValidator {
  validatorId: string;
  backedStake: BigNumber;
  score: BigNumber;
  backers: number;
}

interface Edge {
  validatorId: string;
  load: BigNumber;
  weight: BigNumber;
}

interface Candidate {
  approvalStake: BigNumber;
  backedStake: BigNumber;
  elected: boolean;
  score: BigNumber;
  backers: number;
}

type Validators = Record<string, Candidate>;

/** Returns the element of `arr` with the lowest `score(elt)` value. */
function minBy<T>(arr: T[], score: (t: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const elt of arr) {
    const s = score(elt);
    if (s < bestScore) {
      bestScore = s;
      best = elt;
    }
  }
  return best;
}

const setup = (voters: Voter[]): [Validators, Nominator[]] => {
  const validators: Validators = {};
  const nominators: Nominator[] = voters.map(
    ({ nominatorId, stake, targets }) => {
      const edges: Edge[] = targets.map((candidate) => {
        if (!(candidate in validators)) {
          validators[candidate] = {
            approvalStake: new BigNumber(stake),
            backedStake: new BigNumber(0),
            elected: false,
            score: new BigNumber(0),
            backers: 1,
          };
        } else {
          validators[candidate].approvalStake =
            validators[candidate].approvalStake.plus(stake);
          validators[candidate].backers += 1;
        }
        return {
          validatorId: candidate,
          load: new BigNumber(0),
          weight: new BigNumber(0),
        };
      });
      return {
        nominatorId: nominatorId,
        budget: new BigNumber(stake),
        edges: edges,
        load: new BigNumber(0),
      };
    }
  );
  return [validators, nominators];
};

const equalise = (
  nominators: Nominator[],
  elected: Validators,
  iterations: number
): [Nominator[], Validators] => {
  for (let i = 0; i < iterations; i++) {
    nominators.forEach((nominator) => {
      if (
        nominator.edges.filter(
          ({ validatorId }) => elected[validatorId] !== undefined
        ).length > 1
      ) {
        // Remove all backing
        nominator.edges.forEach((edge) => {
          const validator = elected[edge.validatorId];
          if (validator) {
            validator.backedStake = validator.backedStake.minus(edge.weight);
            edge.weight = new BigNumber(0);
          }
        });

        // Get edges that point to an elected candidate, sort ascending by backedStake
        const electedEdges = nominator.edges
          .filter(({ validatorId }) => elected[validatorId] !== undefined)
          .sort((a, b) =>
            elected[a.validatorId].backedStake.gt(
              elected[b.validatorId].backedStake
            )
              ? 1
              : -1
          );
        let totalBackedStake = new BigNumber(0);
        let lastIndex = electedEdges.length - 1;
        electedEdges.some((edge, idx) => {
          const backedStake = elected[edge.validatorId].backedStake;
          if (
            backedStake.multipliedBy(idx).minus(totalBackedStake).gt(
              nominator.budget
            )
          ) {
            lastIndex = idx - 1;
            return true;
          }
          totalBackedStake = totalBackedStake.plus(backedStake);
          return false;
        });
        const lastStake = elected[electedEdges[lastIndex].validatorId].backedStake;
        const waysToSplit = lastIndex + 1;
        const excess = nominator.budget
          .plus(totalBackedStake)
          .minus(lastStake.multipliedBy(waysToSplit));

        for (let j = 0; j < waysToSplit; j++) {
          electedEdges[j].weight = excess
            .div(waysToSplit)
            .plus(lastStake)
            .minus(elected[electedEdges[j].validatorId].backedStake);
          elected[electedEdges[j].validatorId].backedStake = elected[
            electedEdges[j].validatorId
          ].backedStake.plus(electedEdges[j].weight);
        }
      }
    });
  }
  return [nominators, elected];
};

const seqPhragmenCore = (
  voters: Voter[],
  count: number
): [Nominator[], Validators] => {
  const [validators, nominators] = setup(voters);
  const numVals = Object.keys(validators).length;
  const numRounds = count > numVals ? numVals : count;

  // Main election loop
  const winners: string[] = [];
  for (let round = 0; round < numRounds; round++) {
    // First loop: initialize scores
    Object.keys(validators).forEach((validatorId) => {
      const validator = validators[validatorId];
      if (!validator.elected) {
        if (validator.approvalStake.gt(0)) {
          validator.score = new BigNumber(1).div(validator.approvalStake);
        } else {
          validator.score = new BigNumber(1000);
        }
      }
    });

    // Second loop: increment scores
    nominators.forEach((nominator) => {
      nominator.edges.forEach((edge) => {
        const validator = validators[edge.validatorId];
        if (!validator.elected && validator.approvalStake.gt(0)) {
          validator.score = validator.score.plus(
            nominator.load
              .multipliedBy(nominator.budget)
              .div(validator.approvalStake)
          );
        }
      });
    });

    // Find winner
    const winner =
      minBy(Object.keys(validators), (validatorId) => {
        if (validators[validatorId].elected) {
          return 1000;
        }
        return validators[validatorId].score.toNumber();
      }) || '';
    winners.push(winner);
    validators[winner].elected = true;

    // Third loop: update voter loads
    nominators.forEach((nominator) => {
      nominator.edges.forEach((edge) => {
        if (edge.validatorId === winner) {
          const validator = validators[edge.validatorId];
          edge.load = validator.score.minus(nominator.load);
          nominator.load = validator.score;
        }
      });
    });
  }

  // Update backing stakes
  nominators.forEach((nominator) => {
    nominator.edges.forEach((edge) => {
      const validator = validators[edge.validatorId];
      if (validator.elected) {
        edge.weight = edge.load
          .div(nominator.load)
          .multipliedBy(nominator.budget);
      } else {
        edge.weight = new BigNumber(0);
      }
      validator.backedStake = validator.backedStake.plus(edge.weight);
    });
  });

  const elected: Validators = {};
  winners.forEach((winner) => (elected[winner] = validators[winner]));
  return [nominators, elected];
};

/** Default equalisation iteration count, matching the upstream port. */
export const DEFAULT_EQUALISE_ITERATIONS = 10;

/**
 * Run sequential Phragmén + equalisation against the given voter set,
 * electing `count` validators.
 *
 * Returns the post-election nominator load state (mostly internal) and
 * a stake-descending list of elected validators with their final
 * backed-stake amounts.
 */
export function seqPhragmen(
  voters: Voter[],
  count: number,
  iterations: number = DEFAULT_EQUALISE_ITERATIONS
): [Nominator[], ElectedValidator[]] {
  let [nominators, elected] = seqPhragmenCore(voters, count);
  [nominators, elected] = equalise(nominators, elected, iterations);
  // Sort elected by stake descending
  const ordered: ElectedValidator[] = Object.keys(elected)
    .map((validatorId) => ({
      validatorId,
      backedStake: elected[validatorId].backedStake,
      score: elected[validatorId].score,
      backers: elected[validatorId].backers,
    }))
    .sort((a, b) => (a.backedStake.gt(b.backedStake) ? -1 : 1));
  return [nominators, ordered];
}
