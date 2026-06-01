/**
 * useGovernanceNotifications — bridges Phase 4 chain state into the
 * notification scaffold.
 *
 * Mount once at the App root alongside useMultisigNotifications +
 * useSlashNotifications. Three categories, all derived from the
 * Phase 4 read hooks (no extra chain queries):
 *
 *   - referendum.ending — an ongoing referendum is within the
 *     configured threshold of its end block (default 24h on xx).
 *     Fired for every ongoing referendum, with `userHasVoted` set
 *     so sinks can differentiate "you've voted, here's the close
 *     reminder" from "still time to vote".
 *
 *   - lock.releasable — a conviction lock from a past vote or
 *     delegation has reached its unlockAt block. The user can call
 *     democracy.unlock(target) to release the balance.
 *
 *   - bounty.curator.update_overdue — a bounty the user curates is
 *     past its updateDue block. Failure to post a forum update can
 *     forfeit the curator deposit.
 *
 * Each hook runs its own boot-silence pass: events satisfying the
 * threshold at mount time are marked-as-seen WITHOUT firing, so the
 * user doesn't get a notification storm on cold start. Only genuinely-
 * new threshold crossings (those that didn't satisfy at boot but
 * do now) trigger sinks.
 *
 * The hooks rely on the connection store's blockNumber for the
 * threshold checks — meaning they re-evaluate every ~6 s as the chain
 * head advances. Cheap because the underlying hooks are not
 * re-fetching per tick, only the local threshold check is recomputed.
 */

import { useEffect, useRef } from 'react';
import { useAccountsStore, useConnectionStore } from '@/store';
import {
  useBounties,
  useDemocracy,
  useMyGovernance,
  curatorAddressOf,
} from '@/hooks';
import { emitEvent, silenceEvent } from './registry';

/** Default threshold for "referendum ending" alert: ~24h on xx (6 s/block). */
const REFERENDUM_ENDING_THRESHOLD_BLOCKS = 14_400;

/**
 * Hook that fires governance.referendum.ending events when an ongoing
 * referendum is within `thresholdBlocks` of its end. Set `thresholdBlocks`
 * to 0 to disable (returns immediately).
 */
export function useReferendumEndingNotifications(
  thresholdBlocks = REFERENDUM_ENDING_THRESHOLD_BLOCKS
): void {
  const accounts = useAccountsStore((s) => s.accounts);
  const activeAddress = useAccountsStore((s) => s.activeAddress);
  const blockNumber = useConnectionStore((s) => s.blockNumber);
  const { ongoing } = useDemocracy();
  const { voting } = useMyGovernance(activeAddress);
  const bootSilenced = useRef(false);

  useEffect(() => {
    if (thresholdBlocks <= 0) return;
    if (accounts.length === 0) return;
    if (blockNumber == null) return;
    if (ongoing.length === 0) return;

    const userVotedRefs = new Set<number>(
      voting.kind === 'direct' ? voting.votes.map((v) => v.refIndex) : []
    );

    for (const ref of ongoing) {
      const remaining = ref.end - blockNumber;
      if (remaining <= 0 || remaining > thresholdBlocks) continue;
      const id = `democracy.referendum.ending:${ref.id}:${ref.end}`;
      if (!bootSilenced.current) {
        silenceEvent(id);
      } else {
        emitEvent({
          id,
          kind: 'democracy.referendum.ending',
          refIndex: ref.id,
          endBlock: ref.end,
          blocksRemaining: remaining,
          userHasVoted: userVotedRefs.has(ref.id),
          timestamp: Date.now(),
        });
      }
    }
    if (!bootSilenced.current) bootSilenced.current = true;
  }, [accounts.length, blockNumber, ongoing, voting, thresholdBlocks]);
}

/**
 * Hook that fires governance.lock.releasable events when a conviction
 * lock reaches its unlockAt block. Watches the active account's
 * priorLock from useMyGovernance.
 */
export function useConvictionLockReleaseNotifications(): void {
  const activeAddress = useAccountsStore((s) => s.activeAddress);
  const blockNumber = useConnectionStore((s) => s.blockNumber);
  const { voting } = useMyGovernance(activeAddress);
  const bootSilenced = useRef(false);

  useEffect(() => {
    if (!activeAddress) return;
    if (blockNumber == null) return;
    if (voting.kind === 'none') return;
    const priorLock =
      voting.kind === 'direct' || voting.kind === 'delegating'
        ? voting.priorLock
        : null;
    if (!priorLock) return;
    if (blockNumber < priorLock.unlockAt) return;

    const id = `democracy.lock.releasable:${activeAddress}:${priorLock.unlockAt}`;
    if (!bootSilenced.current) {
      silenceEvent(id);
      bootSilenced.current = true;
    } else {
      emitEvent({
        id,
        kind: 'democracy.lock.releasable',
        accountAddress: activeAddress,
        unlockAt: priorLock.unlockAt,
        amount: priorLock.amount.toString(),
        timestamp: Date.now(),
      });
    }
  }, [activeAddress, blockNumber, voting]);
}

/**
 * Hook that fires bounty.curator.update_overdue events when a bounty
 * the user curates is past its updateDue block.
 */
export function useBountyCuratorUpdateOverdueNotifications(): void {
  const accounts = useAccountsStore((s) => s.accounts);
  const blockNumber = useConnectionStore((s) => s.blockNumber);
  const { bounties } = useBounties();
  const bootSilenced = useRef(false);

  useEffect(() => {
    if (accounts.length === 0) return;
    if (blockNumber == null) return;
    if (bounties.length === 0) return;

    const userAddresses = new Set(accounts.map((a) => a.address));

    for (const b of bounties) {
      const curator = curatorAddressOf(b.status);
      if (!curator || !userAddresses.has(curator)) continue;
      if (b.status.kind !== 'active') continue;
      const due = b.status.updateDue;
      if (blockNumber <= due) continue;

      const id = `bounty.curator.update_overdue:${b.id}:${due}`;
      const overdue = blockNumber - due;
      if (!bootSilenced.current) {
        silenceEvent(id);
      } else {
        emitEvent({
          id,
          kind: 'bounty.curator.update_overdue',
          bountyId: b.id,
          curator,
          updateDue: due,
          blocksOverdue: overdue,
          timestamp: Date.now(),
        });
      }
    }
    if (!bootSilenced.current) bootSilenced.current = true;
  }, [accounts, blockNumber, bounties]);
}

/**
 * Convenience: run all three governance notification hooks in one call.
 * App.tsx uses this so adding/removing categories is a one-line change.
 */
export function useGovernanceNotifications(): void {
  useReferendumEndingNotifications();
  useConvictionLockReleaseNotifications();
  useBountyCuratorUpdateOverdueNotifications();
}
