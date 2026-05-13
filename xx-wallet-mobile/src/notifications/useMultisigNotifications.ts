/**
 * useMultisigNotifications — bridges the wallet's multisig data hooks
 * into the notification scaffold.
 *
 * Mount once at the App root. While mounted, it watches the user's
 * aggregated pending-multisig list and emits a
 * `multisig.proposal.received` event the first time each
 * (multisig, callHash) pair is observed.
 *
 * Boot grace period: on cold start, every pending proposal in the
 * user's wallet looks "new" — we don't want to spam the user (or a
 * downstream Telegram channel) with everything that piled up while
 * the wallet was closed. For the first BOOT_GRACE_MS after mount we
 * silence rather than emit; subsequent genuinely-new proposals fire
 * normally.
 *
 * Cross-session dedupe is handled by the registry's persisted set,
 * so even after a reload outside the grace period we won't re-emit
 * for proposals we've already notified about.
 */

import { useEffect, useRef } from 'react';
import { useAllPendingMultisigs } from '@/hooks/usePendingMultisigs';
import { useMultisigsStore } from '@/store';
import { emitEvent, silenceEvent } from './registry';
import type { MultisigProposalReceivedEvent } from './types';

const BOOT_GRACE_MS = 5_000;

export function useMultisigNotifications(): void {
  const { pending } = useAllPendingMultisigs();
  const multisigs = useMultisigsStore((s) => s.multisigs);

  // Mount time — used to distinguish "we just booted, suppress
  // initial observations" from "the wallet has been open and a new
  // proposal just landed."
  const mountedAt = useRef<number>(Date.now());

  useEffect(() => {
    if (pending.length === 0) return;
    const sinceMount = Date.now() - mountedAt.current;
    const inBootGrace = sinceMount < BOOT_GRACE_MS;

    for (const p of pending) {
      const id = `multisig.proposal.received:${p.multisigAddress}:${p.callHash}`;

      if (inBootGrace) {
        // Cold-start suppression: mark as seen without firing. The
        // registry's persisted dedupe then keeps future polls quiet
        // for these same proposals.
        silenceEvent(id);
        continue;
      }

      // Look up the local nickname + threshold for nicer display.
      // If the multisig record isn't in the store (shouldn't happen
      // since usePendingMultisigs only fetches for known multisigs),
      // fall back to a truncated address.
      const record = multisigs.find((m) => m.address === p.multisigAddress);
      const event: MultisigProposalReceivedEvent = {
        id,
        kind: 'multisig.proposal.received',
        timestamp: Date.now(),
        multisigAddress: p.multisigAddress,
        callHash: p.callHash,
        depositor: p.depositor,
        approvalsCount: p.approvals.length,
        threshold: record?.threshold ?? 0,
        multisigLocalName:
          record?.localName ?? `${p.multisigAddress.slice(0, 8)}…`,
      };
      // emitEvent is idempotent — calling it on every re-render while
      // the proposal is still pending is harmless after the first fire.
      emitEvent(event);
    }
  }, [pending, multisigs]);
}
