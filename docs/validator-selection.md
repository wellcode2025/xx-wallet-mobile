# Validator selection

How the wallet chooses validators for you in the staking flow — both the
automatic recommendation and the optional "Advanced" levers that let you bias
it. Everything here runs on your device against live chain state; nothing is
sent to a server.

## Auto-recommend (the default)

When you bond or change nominations and pick **Auto-recommend**, the wallet:

1. Reads the current staking state from chain — all bonded accounts, ledgers,
   validators, and nominators — and runs the network's own election
   (sequential Phragmén) locally to work out the elected set and each
   validator's backing stake.
2. Scores every elected validator by **projected reward**, which combines three
   things:
   - **Recent performance** — its share of era reward points over roughly the
     last 7 eras, relative to the network average.
   - **Commission** — lower commission means more of the reward reaches you.
   - **Stake spread** — validators whose backing stake is less concentrated
     return more per token nominated.
3. Skips validators that have **blocked** new nominations or are already
   **oversubscribed** (at the chain's backer cap, where extra nominators get
   clipped out of rewards).
4. Takes the **top 16** by that score — the maximum number of validators a
   single nomination can back on xx.

This is a reward optimiser. It's a sound default, but "best projected reward"
isn't the only definition of a good validator — which is what the Advanced
levers are for.

## Advanced levers (optional, off by default)

Behind the **Advanced** link in the auto-recommend view is a small set of
opt-in controls. They re-rank the *same* candidates the wallet already
computed, so changes apply instantly with no re-scan. With everything off, you
get exactly the default ranking above.

- **Prefer validators with an identity** *(soft preference)* — gives a scoring
  bonus to validators that have registered an on-chain identity. It favours,
  but doesn't require, identified operators, so you still get a full set of 16.
- **Prefer less-saturated validators** *(soft preference)* — gives a bonus to
  validators with fewer backers / less concentrated stake. A decentralisation
  tilt; also tends to improve per-token return.
- **Limit commission** *(hard cap)* — only considers validators at or below a
  commission ceiling you set. Unlike the soft preferences, this excludes
  validators above the cap, so a low cap can leave fewer than 16 picks; the
  count updates live so you can see the effect.

"Soft" levers nudge the ranking; the commission cap filters it. The exact
bonus weights are heuristics, deliberately gentle, and chosen so a single lever
never dominates the reward signal.

> **Your nominations are your responsibility.** These controls change which
> validators receive your stake. The defaults are sensible for most people —
> only adjust them if you understand the trade-offs.

## Notes on the xx network specifically

These reflect the live validator set at the time of writing, and shape which
levers are actually useful here:

- **Identity** is "has registered an on-chain identity," not "verified by a
  registrar." xx has no active identity registrars issuing positive judgements,
  so a *verified* filter would match nobody; a registered identity (roughly
  half the set) is the meaningful accountability signal that exists.
- **Performance history** isn't a differentiator today — every current
  validator has recent reward points, so there are no unknown, unrated
  newcomers to screen out. The wallet still defends against that case for the
  future.
- **Self-stake** is uniformly above the chain's minimum validator bond, so a
  self-stake floor wouldn't change much; it isn't exposed as a lever.
- **Commission** skews high (a median around 25%, very few low-commission
  validators), which is why the commission cap is the lever with the largest
  practical effect on xx.

## Where this lives in the code

- Selection + scoring: `xx-wallet-mobile/src/staking/selectValidators.ts`
- Lever re-ranking: `xx-wallet-mobile/src/staking/qualityLevers.ts`
- Feasibility / distribution spike: `xx-wallet-mobile/scripts/spikes/quality-bias-spike.mjs`
