/**
 * Quality levers for the auto-nominate picker.
 *
 * The base auto-pick ranks elected validators by projected reward
 * (performance × stake-spread × (1 − commission)). These optional,
 * user-controlled levers re-rank that same already-computed set so no
 * chain re-read is needed — they're applied client-side to the cached
 * `allElected` list.
 *
 * Defaults are all off, i.e. identical to the base ranking. The levers
 * are deliberately *soft* (score multipliers) except the commission cap,
 * which is an explicit user-set ceiling. Weights here are heuristic
 * starting points; see docs/validator-selection.md for the rationale.
 */

import type { AutoNominateValidator } from './selectValidators';

/** Chain's maxNominatorRewardedPerValidator — backers beyond this are clipped. */
const MAX_BACKERS = 256;
/** Score multiplier applied to validators with a registered on-chain identity. */
const IDENTITY_BONUS = 1.25;
/** Max extra weight for the least-saturated validator (linear to 0 at full). */
const LESS_SATURATED_MAX = 0.5;

export interface QualityLevers {
  /** Favour validators that have registered an on-chain identity. */
  preferIdentity: boolean;
  /** Favour validators with fewer backers / less concentrated stake. */
  preferLessSaturated: boolean;
  /** Hard ceiling on commission (percent, 0..100). null = no cap. */
  maxCommission: number | null;
}

export const DEFAULT_LEVERS: QualityLevers = {
  preferIdentity: false,
  preferLessSaturated: false,
  maxCommission: null,
};

/** How many levers are currently active (drives the "Advanced · N" badge). */
export function leversActiveCount(l: QualityLevers): number {
  return (
    (l.preferIdentity ? 1 : 0) +
    (l.preferLessSaturated ? 1 : 0) +
    (l.maxCommission !== null ? 1 : 0)
  );
}

function leveredScore(v: AutoNominateValidator, levers: QualityLevers): number {
  let score = v.return;
  if (levers.preferIdentity && v.hasIdentity) score *= IDENTITY_BONUS;
  if (levers.preferLessSaturated) {
    const saturation = Math.min(1, v.backers / MAX_BACKERS);
    score *= 1 + LESS_SATURATED_MAX * (1 - saturation);
  }
  return score;
}

/**
 * Re-rank the elected set under the given levers and return the top N.
 * With DEFAULT_LEVERS this reproduces the base selection exactly.
 */
export function applyQualityLevers(
  allElected: AutoNominateValidator[],
  levers: QualityLevers,
  targetCount = 16
): AutoNominateValidator[] {
  const cap = levers.maxCommission;
  return allElected
    .filter((v) => !v.blocked && v.backers < MAX_BACKERS)
    .filter((v) => (cap === null ? true : v.commission <= cap))
    .map((v) => ({ v, score: leveredScore(v, levers) }))
    .sort((a, b) => (a.score > b.score ? -1 : 1))
    .slice(0, targetCount)
    .map((x) => x.v);
}

/** Count validators in `next` that aren't in `base` (by validatorId). */
export function countSelectionChanges(
  next: AutoNominateValidator[],
  base: AutoNominateValidator[]
): number {
  const baseIds = new Set(base.map((v) => v.validatorId));
  return next.reduce((n, v) => (baseIds.has(v.validatorId) ? n : n + 1), 0);
}
