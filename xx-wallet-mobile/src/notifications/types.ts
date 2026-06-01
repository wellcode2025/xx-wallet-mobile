/**
 * Wallet event types — the union of things the wallet can notify about.
 *
 * Sink implementations (in-app toasts, browser notifications, Telegram
 * channels, etc.) receive these via `NotificationSink.emit` and decide
 * what (if anything) to do with each kind.
 *
 * Event IDs are deterministic so the registry can dedupe. Emitting the
 * same logical event twice — e.g. when usePendingMultisigs re-polls and
 * the same proposal is still pending — is a no-op the second time.
 *
 * Pluggable notifications:
 * The wallet emits events through this scaffold; concrete channels
 * (Telegram, browser push, OpenClaw, etc.) plug in as sinks.
 */

export interface BaseWalletEvent {
  /** Stable, deterministic ID. Same logical event → same ID across
   *  polls and reloads, so the registry's dedupe set works. */
  id: string;
  /** When the event happened (or when the wallet first observed it).
   *  UTC milliseconds since epoch. */
  timestamp: number;
}

/**
 * A new multisig proposal was observed at a multisig the user is part
 * of. Fires once per (multisig, callHash) pair across the lifetime of
 * the wallet (dedupe is persisted in localStorage).
 */
export interface MultisigProposalReceivedEvent extends BaseWalletEvent {
  kind: 'multisig.proposal.received';
  multisigAddress: string;
  /** 0x-prefixed lowercase. */
  callHash: string;
  /** Account that submitted the proposal and is paying the deposit. */
  depositor: string;
  /** Approvals already recorded at the time of detection (often just
   *  the depositor's own signature). */
  approvalsCount: number;
  /** Threshold of the multisig this proposal is at. */
  threshold: number;
  /** Multisig's local nickname in the user's wallet, for display. */
  multisigLocalName: string;
}

/**
 * A new approval was added to an existing proposal. Fires once per
 * (multisig, callHash, approver) tuple.
 */
export interface MultisigProposalApprovedEvent extends BaseWalletEvent {
  kind: 'multisig.proposal.approved';
  multisigAddress: string;
  callHash: string;
  approver: string;
  approvalsCount: number;
  threshold: number;
  multisigLocalName: string;
}

/**
 * A proposal executed — threshold met, inner call ran. Fires once per
 * (multisig, callHash).
 */
export interface MultisigProposalExecutedEvent extends BaseWalletEvent {
  kind: 'multisig.proposal.executed';
  multisigAddress: string;
  callHash: string;
  multisigLocalName: string;
}

/**
 * A proposal was canceled by its depositor (deposit reclaimed). Fires
 * once per (multisig, callHash).
 */
export interface MultisigProposalCanceledEvent extends BaseWalletEvent {
  kind: 'multisig.proposal.canceled';
  multisigAddress: string;
  callHash: string;
  multisigLocalName: string;
}

/**
 * A proposal crossed the stale-age threshold the user has configured.
 * Fires once per (multisig, callHash). Useful for "you have an old
 * proposal pending — cancel and reclaim the deposit" nudges.
 */
export interface MultisigProposalStaleEvent extends BaseWalletEvent {
  kind: 'multisig.proposal.stale';
  multisigAddress: string;
  callHash: string;
  ageDays: number;
  multisigLocalName: string;
}

/**
 * A transfer credited one of the user's accounts. Fires once per
 * extrinsic hash.
 */
export interface TransferReceivedEvent extends BaseWalletEvent {
  kind: 'transfer.received';
  toAddress: string;
  fromAddress: string;
  /** Raw planck (1e9 = 1 XX). String to avoid number-precision loss. */
  amount: string;
  blockNumber: number;
  /** 0x-prefixed extrinsic hash. */
  extrinsicHash: string;
}

/**
 * A transfer from one of the user's accounts succeeded. Fires once per
 * extrinsic hash.
 */
export interface TransferSentEvent extends BaseWalletEvent {
  kind: 'transfer.sent';
  fromAddress: string;
  toAddress: string;
  amount: string;
  blockNumber: number;
  extrinsicHash: string;
}

/**
 * The chain reported an offence against a validator the user nominates
 * (or against the user's own validator stash). Fires when xx's
 * `staking.SlashReported` event lands on chain, BEFORE the
 * slashDeferDuration (27 eras) expires. The actionable window: the
 * user can chill their nominations of this validator to avoid the
 * slash entirely.
 *
 * Fires once per (validator, slashEra) tuple.
 */
export interface StakingSlashReportedEvent extends BaseWalletEvent {
  kind: 'staking.slash.reported';
  /** The validator with the reported offence. */
  validatorAddress: string;
  /** Perbill (0..1e9). 1e9 = 100% of stake slashed. */
  fraction: number;
  /** Era the offence was committed in. */
  slashEra: number;
  /** Era the slash will apply if not deferred-out. Equals
   *  slashEra + slashDeferDuration. Currently 27 eras = 27 days on xx. */
  applicableEra: number;
  /** Block number this event was emitted in. */
  blockNumber: number;
  /** Which of the user's accounts has exposure to this validator —
   *  either equal to validatorAddress (the user IS the validator) or
   *  the stash of a nominator-of-validator user account. Helps the UI
   *  show which account to chill from. */
  affectedUserAddress: string;
  /** True if the user is the validator (own stash). False if the user
   *  is a nominator of the validator. */
  isOwnValidator: boolean;
}

/**
 * The chain finally applied a slash to one of the user's accounts
 * (either as validator or as nominator backing a slashed validator).
 * Fires once per (account, blockNumber) tuple. Post-mortem signal —
 * the slash has already been deducted from the bonded ledger.
 */
export interface StakingSlashedEvent extends BaseWalletEvent {
  kind: 'staking.slashed';
  /** The user account that took the slash. */
  stakerAddress: string;
  /** Raw planck deducted from this account's bonded total. */
  amount: string;
  blockNumber: number;
}

/**
 * A democracy referendum the user has voted on (or any active referendum
 * if the user hasn't voted) is within the configured threshold of its
 * end block. Default threshold: 24 hours (14,400 blocks at 6 s/block).
 *
 * Fires once per refIndex per threshold-crossing — if the user reloads
 * the wallet on the last day the registry's persisted dedupe set
 * prevents a re-emit.
 */
export interface DemocracyReferendumEndingEvent extends BaseWalletEvent {
  kind: 'democracy.referendum.ending';
  refIndex: number;
  endBlock: number;
  /** Blocks remaining when the alert fires. */
  blocksRemaining: number;
  /** True iff the user has cast a vote on this referendum. */
  userHasVoted: boolean;
}

/**
 * A conviction lock from a past democracy vote or delegation has
 * reached its unlockAt block — the locked balance can now be released
 * by calling `democracy.unlock(target)`.
 *
 * Fires once per (account, unlockAt) pair.
 */
export interface DemocracyLockReleasableEvent extends BaseWalletEvent {
  kind: 'democracy.lock.releasable';
  accountAddress: string;
  unlockAt: number;
  /** Raw planck amount that's now releasable. */
  amount: string;
}

/**
 * A bounty the user curates is past its `updateDue` block — the curator
 * is expected to post a status update on the forum. Failure to update
 * can lead to the bounty being closed and the curator deposit forfeit.
 *
 * Fires once per (bountyId, updateDue) pair.
 */
export interface BountyCuratorUpdateOverdueEvent extends BaseWalletEvent {
  kind: 'bounty.curator.update_overdue';
  bountyId: number;
  curator: string;
  updateDue: number;
  /** Blocks past the updateDue at observation. */
  blocksOverdue: number;
}

/**
 * Discriminated union of all wallet events. Sinks should `switch`
 * on `event.kind` for type-safe access to per-event fields.
 */
export type WalletEvent =
  | MultisigProposalReceivedEvent
  | MultisigProposalApprovedEvent
  | MultisigProposalExecutedEvent
  | MultisigProposalCanceledEvent
  | MultisigProposalStaleEvent
  | TransferReceivedEvent
  | TransferSentEvent
  | StakingSlashReportedEvent
  | StakingSlashedEvent
  | DemocracyReferendumEndingEvent
  | DemocracyLockReleasableEvent
  | BountyCuratorUpdateOverdueEvent;

export type WalletEventKind = WalletEvent['kind'];
