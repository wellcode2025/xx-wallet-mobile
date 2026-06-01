/**
 * Wallet-inline sink — surfaces actionable events directly in the
 * wallet UI without requiring the user to plug in an external channel.
 *
 * Currently this only handles slash-flavored events; multisig
 * and transfer events still pass through the noop default (and any
 * plugin sink the user registers). Future scope could broaden the
 * inline surface via the pluggable notification design.
 *
 * Writes to `useAlertsStore` which a banner on MyNominations renders.
 * The store is persisted, so a slash alert observed mid-session
 * survives a reload during the 27-era defer window.
 */

import { useAlertsStore } from '@/store';
import type { NotificationSink } from './sink';
import type { WalletEvent } from './types';

export const inlineSink: NotificationSink = {
  id: 'wallet-inline',
  emit(event: WalletEvent): void {
    const push = useAlertsStore.getState().push;
    switch (event.kind) {
      case 'staking.slash.reported':
        push({
          id: event.id,
          kind: 'slash.reported',
          validatorAddress: event.validatorAddress,
          fraction: event.fraction,
          slashEra: event.slashEra,
          applicableEra: event.applicableEra,
          affectedUserAddress: event.affectedUserAddress,
          isOwnValidator: event.isOwnValidator,
          blockNumber: event.blockNumber,
          observedAt: event.timestamp,
          dismissed: false,
        });
        return;
      case 'staking.slashed':
        push({
          id: event.id,
          kind: 'slash.applied',
          stakerAddress: event.stakerAddress,
          amount: event.amount,
          blockNumber: event.blockNumber,
          observedAt: event.timestamp,
          dismissed: false,
        });
        return;
      // Other event kinds: noop. External sinks (Telegram, OpenClaw,
      // etc.) handle them on whatever channels users have plugged in.
      default:
        return;
    }
  },
};
