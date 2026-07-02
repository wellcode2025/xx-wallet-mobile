/**
 * Notification scaffold barrel.
 *
 * Public API:
 *   - `WalletEvent` + per-kind interfaces — the event types
 *   - `NotificationSink` + `noopSink` — the consumer interface
 *   - `registerSink` / `unregisterSink` / `emitEvent` / `silenceEvent` —
 *     the registry operations
 *   - `useMultisigNotifications` — React hook that wires the multisig
 *     data hooks into the notification scaffold (mount once at App root)
 *
 * For plugin authors: register a sink with `registerSink` and switch
 * on `event.kind` inside its `emit`. See sink.ts for the contract.
 */

export type {
  BaseWalletEvent,
  WalletEvent,
  WalletEventKind,
  MultisigProposalReceivedEvent,
  MultisigProposalApprovedEvent,
  MultisigProposalExecutedEvent,
  MultisigProposalCanceledEvent,
  MultisigProposalStaleEvent,
  TransferReceivedEvent,
  TransferSentEvent,
  StakingSlashReportedEvent,
  StakingSlashedEvent,
  DemocracyReferendumEndingEvent,
  DemocracyLockReleasableEvent,
  BountyCuratorUpdateOverdueEvent,
} from './types';

export type { NotificationSink } from './sink';
export { noopSink } from './sink';
export { inlineSink } from './inlineSink';

export {
  registerSink,
  unregisterSink,
  emitEvent,
  silenceEvent,
  listSinks,
} from './registry';

export { useMultisigNotifications } from './useMultisigNotifications';
export { useSlashNotifications } from './useSlashNotifications';
export { useCmixReceive } from './useCmixReceive';
export { useCmixChatReceive } from './useCmixChatReceive';
export { useCmixChatResend } from './useCmixChatResend';
export {
  useGovernanceNotifications,
  useReferendumEndingNotifications,
  useConvictionLockReleaseNotifications,
  useBountyCuratorUpdateOverdueNotifications,
} from './useGovernanceNotifications';
