/**
 * useSlashNotifications — bridges xx network's staking offence chain
 * events into the wallet's notification scaffold.
 *
 * Mount once at the App root alongside useMultisigNotifications. While
 * mounted, it subscribes to `api.query.system.events` and watches for:
 *
 *   - `staking.SlashReported(validator, fraction, slashEra)` — fired
 *     when an offence is reported against a validator. The slash
 *     applies at slashEra + slashDeferDuration (27 eras = 27 days on
 *     xx). The actionable window: nominators of the validator can
 *     `staking.chill()` before the slash applies and avoid it.
 *
 *   - `staking.Slashed(staker, amount)` — fired when a slash actually
 *     applies to a stash. Post-mortem signal.
 *
 * For each event we check whether any of the user's accounts are
 * affected — either by owning the validator stash or by nominating
 * the slashed validator — and if so, emit through the notification
 * scaffold (which fans out to the inline + any plugin sinks).
 *
 * No boot-grace suppression: slash events from before the wallet
 * opened are still actionable during the 27-era defer window, so we
 * WANT to see them. The registry's persisted dedupe set prevents
 * re-emitting the same logical event across reloads.
 */

import { useEffect } from 'react';
import { useAccountsStore } from '@/store';
import { xxApi } from '@/api';
import { emitEvent } from './registry';
import type {
  StakingSlashReportedEvent,
  StakingSlashedEvent,
} from './types';

const DEFAULT_SLASH_DEFER_DURATION = 27;

export function useSlashNotifications(): void {
  const accounts = useAccountsStore((s) => s.accounts);

  useEffect(() => {
    if (accounts.length === 0) return;
    let cancelled = false;
    let unsubEvents: (() => void) | null = null;
    let unsubHeads: (() => void) | null = null;

    (async () => {
      try {
        const api = await xxApi.getApi();
        if (cancelled) return;

        const userAddresses = new Set(accounts.map((a) => a.address));

        // Read slashDeferDuration once — chain constant, doesn't change
        // without a runtime upgrade.
        const slashDeferDuration =
          (api.consts.staking as any)?.slashDeferDuration?.toNumber?.() ??
          DEFAULT_SLASH_DEFER_DURATION;

        // Track latest block number via finalized-heads subscription.
        // SlashReported events go to finality fast on xx (~18s) — using
        // best-known number here gives off-by-1 at worst, acceptable
        // for slash alert framing.
        let latestBlockNumber = 0;
        const headSub = await api.rpc.chain.subscribeFinalizedHeads(
          (header: any) => {
            latestBlockNumber = header.number.toNumber();
          }
        );
        unsubHeads = () => headSub();

        // Subscribe to events. The subscription overload of
        // api.query.system.events returns Promise<UnsubscribeFn>, but
        // polkadot.js's typed API resolves to Codec by default — cast
        // through unknown to access the actual returned unsubscribe.
        const eventsSub = (await api.query.system.events((events: any) => {
          // events is a Vec<EventRecord>; iterate using forEach since
          // Codec arrays support it directly.
          events.forEach((record: any) => {
            const { event } = record;
            if (event.section !== 'staking') return;

            if (event.method === 'SlashReported') {
              handleSlashReported(
                event.data,
                userAddresses,
                slashDeferDuration,
                latestBlockNumber,
                api
              ).catch((err) => {
                console.warn(
                  '[slash-notifications] SlashReported handling failed:',
                  err
                );
              });
              return;
            }

            if (event.method === 'Slashed') {
              const staker = event.data[0]?.toString?.();
              const amount = event.data[1]?.toString?.();
              if (!staker) return;
              if (!userAddresses.has(staker)) return;
              const ev: StakingSlashedEvent = {
                id: `staking.slashed:${staker}:${latestBlockNumber}`,
                kind: 'staking.slashed',
                timestamp: Date.now(),
                stakerAddress: staker,
                amount: amount ?? '0',
                blockNumber: latestBlockNumber,
              };
              emitEvent(ev);
            }
          });
        })) as unknown as () => void;
        unsubEvents = eventsSub;
      } catch (err) {
        if (!cancelled) {
          console.warn(
            '[slash-notifications] subscription failed:',
            err
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unsubEvents) unsubEvents();
      if (unsubHeads) unsubHeads();
    };
  }, [accounts]);
}

/**
 * For each SlashReported, check whether any user account is affected
 * (own validator OR nominator of the reported validator) and emit.
 *
 * Nominations are read live per-event because SlashReported is rare
 * and caching staleness risks missing real cases when the user just
 * re-nominated.
 */
async function handleSlashReported(
  eventData: any,
  userAddresses: Set<string>,
  slashDeferDuration: number,
  blockNumber: number,
  api: any
): Promise<void> {
  const validator = eventData[0]?.toString?.();
  const fraction = eventData[1]?.toNumber?.() ?? 0;
  const slashEra = eventData[2]?.toNumber?.() ?? 0;
  if (!validator) return;
  const applicableEra = slashEra + slashDeferDuration;

  for (const userAddr of userAddresses) {
    // Case 1: user owns the validator stash.
    if (userAddr === validator) {
      const ev: StakingSlashReportedEvent = {
        id: `staking.slash.reported:${validator}:${slashEra}:${userAddr}`,
        kind: 'staking.slash.reported',
        timestamp: Date.now(),
        validatorAddress: validator,
        fraction,
        slashEra,
        applicableEra,
        blockNumber,
        affectedUserAddress: userAddr,
        isOwnValidator: true,
      };
      emitEvent(ev);
      continue;
    }
    // Case 2: user nominates the reported validator.
    const nomsOpt: any = await api.query.staking.nominators(userAddr);
    if (!nomsOpt?.isSome) continue;
    const targets: string[] = nomsOpt
      .unwrap()
      .targets.map((t: any) => t.toString());
    if (!targets.includes(validator)) continue;
    const ev: StakingSlashReportedEvent = {
      id: `staking.slash.reported:${validator}:${slashEra}:${userAddr}`,
      kind: 'staking.slash.reported',
      timestamp: Date.now(),
      validatorAddress: validator,
      fraction,
      slashEra,
      applicableEra,
      blockNumber,
      affectedUserAddress: userAddr,
      isOwnValidator: false,
    };
    emitEvent(ev);
  }
}
