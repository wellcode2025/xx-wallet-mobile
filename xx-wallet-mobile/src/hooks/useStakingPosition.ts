/**
 * useStakingPosition — the active account's on-chain staking position.
 *
 * Everything here comes from the chain, never the indexer. "Am I
 * nominating, and is each nomination actually earning?" is a
 * trust-critical question, so it gets the same decoded-from-source
 * discipline the multisig approval flow uses. The indexer is fine for
 * historical rewards (slice 4) but the live position is chain-only.
 *
 * Fetch-once, not a subscription: the staking exposure
 * (erasStakersClipped) is a snapshot taken at era start and cannot
 * change until the next era — ~24h on xx network. Subscribing to new
 * heads to re-query it would be pure waste. We refetch when the
 * address changes; a manual refresh affordance can come later if it's
 * ever wanted.
 *
 * Account-agnostic: works for a plain stash or a multisig address
 * identically — a multisig is just an AccountId on chain. Slice 1
 * wires it for the active account; the multisig detail screen can
 * reuse it later by passing the multisig address.
 */

import { useEffect, useState } from 'react';
import type { BN } from '@polkadot/util';
import { xxApi } from '@/api';

/**
 * Per-target status, derived from the validator's clipped exposure
 * (erasStakersClipped) in the active era:
 *   - 'active'      — your stake is in this validator's rewarded set;
 *                     you earn from it this era
 *   - 'not-earning' — the validator is elected, but you're not in its
 *                     rewarded set: either the rewarded set is full
 *                     (clipped) or the election assigned your weight
 *                     to your other nominations
 *   - 'inactive'    — the validator isn't in the elected set this era
 */
export type NominationStatus = 'active' | 'not-earning' | 'inactive';

export interface UnlockingChunk {
  /** Era at which this chunk becomes redeemable. */
  era: number;
  /** Amount in raw planck. */
  value: BN;
}

export interface BondedLedger {
  /** Total bonded — active stake plus anything currently unbonding. */
  total: BN;
  /** Actively staked: backs nominations, counts in elections. */
  active: BN;
  /** Number of unbonding chunks in flight. */
  unlockingCount: number;
  /** Per-chunk unbonding detail (era + amount). Empty when nothing is unlocking. */
  unlocking: UnlockingChunk[];
}

export interface StakingPosition {
  /** True when staking.nominators returned Some for this address. */
  isNominating: boolean;
  /** Validator addresses the account nominates. Empty when not nominating. */
  targets: string[];
  /** Per-target status, keyed by validator address. Empty when the
   *  active era couldn't be read (statuses can't be derived without it). */
  targetStatus: Record<string, NominationStatus>;
  /** Era the current nomination was submitted in. */
  submittedInEra: number | null;
  /** True if the nominator has been chilled/suppressed on chain. */
  suppressed: boolean;
  /** Bonded ledger, or null if the account isn't bonded at all. */
  ledger: BondedLedger | null;
  /** The era target status was evaluated against. Null if unreadable. */
  activeEra: number | null;
}

interface UseStakingPositionResult {
  position: StakingPosition | null;
  isLoading: boolean;
  error: Error | null;
}

export function useStakingPosition(
  address: string | null | undefined
): UseStakingPositionResult {
  const [position, setPosition] = useState<StakingPosition | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!address) {
      setPosition(null);
      return;
    }

    let cancelled = false;
    // Clear stale data synchronously so switching accounts doesn't flash
    // the previous account's position while the new fetch is in flight.
    setPosition(null);
    setError(null);
    setIsLoading(true);

    (async () => {
      try {
        const api = await xxApi.getApi();
        if (cancelled) return;

        // Active era — the era whose exposure snapshot is currently live.
        const activeEraOpt: any = await api.query.staking.activeEra();
        const activeEra: number | null = activeEraOpt?.isSome
          ? activeEraOpt.unwrap().index.toNumber()
          : null;

        // Bonded ledger. staking.bonded(stash) -> Option<controller>;
        // staking.ledger(controller) -> Option<StakingLedger>.
        let ledger: BondedLedger | null = null;
        const bondedOpt: any = await api.query.staking.bonded(address);
        if (bondedOpt?.isSome) {
          const controller = bondedOpt.unwrap().toString();
          const ledgerOpt: any = await api.query.staking.ledger(controller);
          if (ledgerOpt?.isSome) {
            const l = ledgerOpt.unwrap();
            const unlocking: UnlockingChunk[] = (l.unlocking ?? []).map(
              (chunk: any) => ({
                era: chunk.era.toNumber(),
                value: chunk.value.toBn(),
              })
            );
            ledger = {
              total: l.total.toBn(),
              active: l.active.toBn(),
              unlockingCount: l.unlocking.length,
              unlocking,
            };
          }
        }

        // Nominations.
        const nominatorsOpt: any = await api.query.staking.nominators(address);
        if (cancelled) return;

        if (!nominatorsOpt?.isSome) {
          setPosition({
            isNominating: false,
            targets: [],
            targetStatus: {},
            submittedInEra: null,
            suppressed: false,
            ledger,
            activeEra,
          });
          setIsLoading(false);
          return;
        }

        const nom = nominatorsOpt.unwrap();
        const targets: string[] = nom.targets.map((t: any) => t.toString());
        const submittedInEra: number = nom.submittedIn.toNumber();
        const suppressed: boolean = nom.suppressed?.isTrue === true;

        // Per-target status from each validator's clipped exposure in the
        // active era. erasStakersClipped is the *rewarded* set — if the
        // user's address is in `others`, they earn from that validator
        // this era. total === 0 means the validator isn't elected at all.
        const targetStatus: Record<string, NominationStatus> = {};
        if (activeEra !== null) {
          const exposures = await Promise.all(
            targets.map(
              (t) =>
                api.query.staking.erasStakersClipped(
                  activeEra,
                  t
                ) as Promise<any>
            )
          );
          if (cancelled) return;
          targets.forEach((t, i) => {
            const exp = exposures[i];
            const total: BN | null = exp?.total?.toBn?.() ?? null;
            if (!total || total.isZero()) {
              targetStatus[t] = 'inactive';
              return;
            }
            const others: any[] = exp.others ?? [];
            const isBacking = others.some(
              (o) => o?.who?.toString?.() === address
            );
            targetStatus[t] = isBacking ? 'active' : 'not-earning';
          });
        }

        if (cancelled) return;
        setPosition({
          isNominating: true,
          targets,
          targetStatus,
          submittedInEra,
          suppressed,
          ledger,
          activeEra,
        });
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  return { position, isLoading, error };
}
