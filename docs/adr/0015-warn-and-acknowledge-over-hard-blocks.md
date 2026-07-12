# ADR-0015: Risk-to-self gets a warning + explicit acknowledgement; only integrity violations get hard blocks

- Status: accepted (retroactive capture; pattern set 2026-06-11 with the exchange-routing caution)
- Date: 2026-07-08
- Tier: T1
- Review: independent

## Context

Some user actions are dangerous but legitimate. The canonical case: sending from a multisig or protected account directly to an exchange — the transfer nests inside `multisig.asMulti`, exchange deposit scanners miss it, and the deposit is stranded. A wallet that hard-blocks such actions protects some users by trapping others (there are valid reasons to send from a multisig to an address the wallet doesn't recognize). A wallet that stays silent abandons them.

## Decision

Two classes, two behaviors:

1. **Integrity violations — refuse outright.** Hash mismatch on call bytes (ADR-0002), un-derivable multisig address on import, invalid SS58 recipient, self-send (a fee-only no-op), keystores in unexpected formats (ADR-0001). These are provably wrong; there is no informed way to want them.
2. **Risk-to-self — warn and require explicit acknowledgement, then allow.** MultisigPropose shows a standing one-liner under the recipient field and escalates to a full warning **with a required acknowledgement** when the recipient is a valid address the wallet doesn't recognize; sub-existential-deposit recipient warnings; recovery-phrase clipboard cautions. The user is told exactly what the risk is and consciously accepts it — the wallet never lies and never silently permits.

## Alternatives considered

- **Hard-block risky-but-legitimate actions:** rejected — gatekeeping that assumes the wallet knows better than an informed user, and it breaks real workflows (the wallet cannot know every legitimate unrecognized recipient).
- **Warn without acknowledgement:** rejected for the high-consequence cases — passive banners get banner-blindness; the acknowledgement makes the choice conscious.

## Consequences

A consistent, predictable safety grammar across the app: users learn that a refusal means "provably wrong" and an acknowledgement means "your call, eyes open." New features must classify their failure modes into these two classes at design time — a good Plan-stage question at T1+.

## Reversibility

Pure policy; trivially reversible per surface, but consistency is the value — exceptions in either direction should cite this ADR.
